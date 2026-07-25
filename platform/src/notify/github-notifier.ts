import type { ImpactReport } from '../domain/impact.ts';
import type {
  ImpactFeedback,
  ImpactFeedbackInput,
  Notification,
  Notifier,
} from '../ports/index.ts';
import {
  githubApiBaseFromEnv,
  githubTokenFromEnv,
  type FetchLike,
} from '../integration/adapters/github-pr-files.ts';
import { checkRunTitle, verdictToConclusion } from './check-map.ts';
import { formatImpactPrComment, shouldPostPrComment } from './comment.ts';

export interface GitHubNotifierOptions {
  /** Bearer token from GITHUB_TOKEN / GH_TOKEN. */
  token?: string;
  /**
   * API root, e.g. "https://api.github.com" or GHE `/api/v3`.
   * Never hardcode an org/repo — resolve from subscription `githubFullName`.
   */
  apiBaseUrl?: string;
  /** Injected for offline tests. Defaults to global fetch. */
  fetch?: FetchLike;
  /** Check run name (from PLATFORM_GITHUB_CHECK_NAME). */
  checkName?: string;
  /** Deep-link base for PR comment (PLATFORM_DEEP_LINK_BASE_URL). */
  deepLinkBaseUrl?: string;
  /** Optional structured logger (Nest Logger, console, …). */
  onLog?: (message: string) => void;
}

const DEFAULT_API = 'https://api.github.com';
const DEFAULT_CHECK_NAME = 'InfraGraph Impact';

function splitFullName(fullName: string): { owner: string; repo: string } | null {
  const parts = fullName.trim().split('/').filter(Boolean);
  if (parts.length < 2) return null;
  return { owner: parts[0], repo: parts.slice(1).join('/') };
}

export function githubCheckNameFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  const v = (env.PLATFORM_GITHUB_CHECK_NAME || '').trim();
  return v || DEFAULT_CHECK_NAME;
}

/**
 * Real GitHub adapter behind `Notifier` + `ImpactFeedback`.
 * Creates/updates Check Runs and posts compact PR comments. Recipients are
 * resolved upstream (subscription contacts + config roles) — never hardcoded.
 */
export class GitHubNotifier implements Notifier, ImpactFeedback {
  private readonly token: string;
  private readonly apiBaseUrl: string;
  private readonly fetchFn: FetchLike;
  private readonly checkName: string;
  private readonly deepLinkBaseUrl: string;
  private readonly onLog?: (message: string) => void;

  /** Last check-run id per head sha (best-effort update on override republish). */
  private readonly checkRunIds = new Map<string, number>();

  constructor(opts: GitHubNotifierOptions = {}) {
    this.token = opts.token ?? '';
    this.apiBaseUrl = (opts.apiBaseUrl || DEFAULT_API).replace(/\/$/, '');
    this.fetchFn = opts.fetch ?? (globalThis.fetch as FetchLike);
    this.checkName = (opts.checkName || DEFAULT_CHECK_NAME).trim() || DEFAULT_CHECK_NAME;
    this.deepLinkBaseUrl = opts.deepLinkBaseUrl ?? '';
    this.onLog = opts.onLog;
  }

  static fromEnv(
    env: NodeJS.ProcessEnv = process.env,
    overrides: GitHubNotifierOptions = {},
  ): GitHubNotifier {
    return new GitHubNotifier({
      token: overrides.token ?? githubTokenFromEnv(env),
      apiBaseUrl: overrides.apiBaseUrl ?? githubApiBaseFromEnv(env),
      fetch: overrides.fetch,
      checkName: overrides.checkName ?? githubCheckNameFromEnv(env),
      deepLinkBaseUrl:
        overrides.deepLinkBaseUrl ?? (env.PLATFORM_DEEP_LINK_BASE_URL || '').trim(),
      onLog: overrides.onLog,
    });
  }

  /**
   * Fallback when there is no PR/check context (e.g. tag-only path without feedback).
   * Does not invent GitHub handles — logs resolved recipients only.
   */
  async send(notifications: Notification[]): Promise<void> {
    for (const n of notifications) {
      this.log(
        `notify role=${n.role} recipient=${n.recipient} reason=${n.reason} report=${n.reportId}`,
      );
    }
  }

  async publish(input: ImpactFeedbackInput): Promise<void> {
    const id = splitFullName(input.repoFullName);
    if (!id) {
      this.log(`feedback skipped: invalid repoFullName`);
      if (input.notifications.length) await this.send(input.notifications);
      return;
    }

    const { report, notifications } = input;
    await this.upsertCheckRun(id.owner, id.repo, report);

    if (shouldPostPrComment(report) && report.prNumber && report.prNumber > 0) {
      const body = formatImpactPrComment(report, notifications, {
        deepLinkBaseUrl: this.deepLinkBaseUrl,
        productLabel: this.checkName,
      });
      await this.postPrComment(id.owner, id.repo, report.prNumber, body);
    } else if (report.silent || !report.impactExists) {
      this.log(`PR comment skipped (silent / no IaC impact) report=${report.reportId}`);
    }

    // Recipients already surfaced via comment mentions when architects resolve;
    // still log consumer_owner / pr_author for auditability.
    if (notifications.length) await this.send(notifications);
  }

  private async upsertCheckRun(
    owner: string,
    repo: string,
    report: ImpactReport,
  ): Promise<void> {
    const headSha = (report.headSha || '').trim();
    if (!headSha) {
      this.log(`check run skipped: missing headSha report=${report.reportId}`);
      return;
    }

    const conclusion = verdictToConclusion(report);
    const title = checkRunTitle(report);
    const summary = report.silent
      ? 'No IaC-relevant impact detected.'
      : `Verdict **${report.verdict}** · ${report.consumers.length} consumer(s).`;

    const payload: Record<string, unknown> = {
      name: this.checkName,
      head_sha: headSha,
      status: 'completed',
      conclusion,
      output: {
        title,
        summary,
      },
    };

    const cacheKey = `${owner}/${repo}@${headSha}|${this.checkName}`;
    const existingId = this.checkRunIds.get(cacheKey);

    let url: string;
    let method: string;
    if (existingId) {
      url =
        `${this.apiBaseUrl}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}` +
        `/check-runs/${existingId}`;
      method = 'PATCH';
    } else {
      url =
        `${this.apiBaseUrl}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}` +
        `/check-runs`;
      method = 'POST';
    }

    try {
      const res = await this.fetchFn(url, {
        method,
        headers: {
          ...this.headers(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        this.log(`check run ${method} failed status=${res.status} report=${report.reportId}`);
        return;
      }
      try {
        const body = (await res.json()) as { id?: number };
        if (typeof body.id === 'number') this.checkRunIds.set(cacheKey, body.id);
      } catch {
        /* ignore parse */
      }
      this.log(
        `check run ${method === 'POST' ? 'created' : 'updated'} conclusion=${conclusion} report=${report.reportId}`,
      );
    } catch {
      this.log(`check run request error report=${report.reportId}`);
    }
  }

  private async postPrComment(
    owner: string,
    repo: string,
    prNumber: number,
    body: string,
  ): Promise<void> {
    const url =
      `${this.apiBaseUrl}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}` +
      `/issues/${prNumber}/comments`;
    try {
      const res = await this.fetchFn(url, {
        method: 'POST',
        headers: {
          ...this.headers(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ body }),
      });
      if (!res.ok) {
        this.log(`PR comment failed status=${res.status} pr=${prNumber}`);
        return;
      }
      this.log(`PR comment posted pr=${prNumber}`);
    } catch {
      this.log(`PR comment request error pr=${prNumber}`);
    }
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    if (this.token) h.Authorization = `Bearer ${this.token}`;
    return h;
  }

  private log(message: string): void {
    if (this.onLog) this.onLog(message);
  }
}
