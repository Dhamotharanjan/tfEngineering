import type { FileChange } from '../../domain/events.ts';
import type {
  PrFileFetchRequest,
  PrFileFetchResult,
  PrFileFetcher,
} from '../pr-files.ts';

export type FetchLike = (
  input: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
  json(): Promise<unknown>;
}>;

export interface GitHubPrFileFetcherOptions {
  /** Bearer token from GITHUB_TOKEN / GH_TOKEN. Empty → public API only. */
  token?: string;
  /**
   * API root, e.g. "https://api.github.com" or "https://ghe.example/api/v3".
   * Derived from GITHUB_HOST when using fromEnv; never hardcode an org/repo.
   */
  apiBaseUrl?: string;
  /** Injected for offline tests. Defaults to global fetch. */
  fetch?: FetchLike;
  /** When true (default), also load base/head file contents for pin-delta analysis. */
  includeContents?: boolean;
}

const DEFAULT_API = 'https://api.github.com';

function mapStatus(s: string | undefined): FileChange['status'] {
  switch ((s || '').toLowerCase()) {
    case 'added':
      return 'added';
    case 'removed':
      return 'removed';
    case 'renamed':
      return 'renamed';
    default:
      return 'modified';
  }
}

function splitFullName(fullName: string): { owner: string; repo: string } | null {
  const parts = fullName.trim().split('/').filter(Boolean);
  if (parts.length < 2) return null;
  return { owner: parts[0], repo: parts.slice(1).join('/') };
}

/** Resolve GitHub REST API base from env (GITHUB_HOST for GHE). */
export function githubApiBaseFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  const host = (env.GITHUB_HOST || '').trim();
  if (!host || host === 'github.com') return DEFAULT_API;
  const cleaned = host.replace(/^https?:\/\//, '').replace(/\/$/, '');
  return `https://${cleaned}/api/v3`;
}

export function githubTokenFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  return (env.GITHUB_TOKEN || env.GH_TOKEN || '').trim();
}

/**
 * Lists PR files via GitHub REST (`GET /repos/{owner}/{repo}/pulls/{n}/files`).
 * Optionally loads blob contents at base/head for pin-delta extraction.
 * Offline-testable via injected `fetch`.
 */
export class GitHubPrFileFetcher implements PrFileFetcher {
  private readonly token: string;
  private readonly apiBaseUrl: string;
  private readonly fetchFn: FetchLike;
  private readonly includeContents: boolean;

  constructor(opts: GitHubPrFileFetcherOptions = {}) {
    this.token = opts.token ?? '';
    this.apiBaseUrl = (opts.apiBaseUrl || DEFAULT_API).replace(/\/$/, '');
    this.fetchFn = opts.fetch ?? (globalThis.fetch as FetchLike);
    this.includeContents = opts.includeContents !== false;
  }

  static fromEnv(env: NodeJS.ProcessEnv = process.env, overrides: GitHubPrFileFetcherOptions = {}): GitHubPrFileFetcher {
    return new GitHubPrFileFetcher({
      token: overrides.token ?? githubTokenFromEnv(env),
      apiBaseUrl: overrides.apiBaseUrl ?? githubApiBaseFromEnv(env),
      fetch: overrides.fetch,
      includeContents: overrides.includeContents,
    });
  }

  async fetchChangedFiles(req: PrFileFetchRequest): Promise<PrFileFetchResult> {
    const id = splitFullName(req.repoFullName);
    if (!id || !req.prNumber || req.prNumber < 1) {
      return { ok: false, reason: 'invalid_request' };
    }

    const filesUrl =
      `${this.apiBaseUrl}/repos/${encodeURIComponent(id.owner)}/${encodeURIComponent(id.repo)}` +
      `/pulls/${req.prNumber}/files?per_page=100`;

    let listRes;
    try {
      listRes = await this.fetchFn(filesUrl, { method: 'GET', headers: this.headers() });
    } catch {
      return { ok: false, reason: 'http_error' };
    }
    if (!listRes.ok) {
      return { ok: false, reason: 'http_error', status: listRes.status };
    }

    let rows: unknown;
    try {
      rows = await listRes.json();
    } catch {
      return { ok: false, reason: 'parse_error' };
    }
    if (!Array.isArray(rows)) {
      return { ok: false, reason: 'parse_error' };
    }

    const files: FileChange[] = [];
    for (const row of rows) {
      const r = row as Record<string, unknown>;
      const path = typeof r.filename === 'string' ? r.filename : '';
      if (!path) continue;
      const status = mapStatus(typeof r.status === 'string' ? r.status : undefined);
      const change: FileChange = { path, status };

      if (this.includeContents) {
        const baseSha = req.baseSha || undefined;
        const headSha = req.headSha || undefined;
        if (status !== 'added' && baseSha) {
          change.previousContent = await this.fetchBlob(id.owner, id.repo, path, baseSha);
        } else {
          change.previousContent = null;
        }
        if (status !== 'removed' && headSha) {
          const headPath =
            status === 'renamed' && typeof r.filename === 'string' ? r.filename : path;
          change.newContent = await this.fetchBlob(id.owner, id.repo, headPath, headSha);
        } else {
          change.newContent = null;
        }
      }

      files.push(change);
    }

    return { ok: true, files };
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    if (this.token) h.Authorization = `Bearer ${this.token}`;
    return h;
  }

  private async fetchBlob(
    owner: string,
    repo: string,
    path: string,
    ref: string,
  ): Promise<string | null> {
    const url =
      `${this.apiBaseUrl}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}` +
      `/contents/${path
        .split('/')
        .map((p) => encodeURIComponent(p))
        .join('/')}?ref=${encodeURIComponent(ref)}`;
    try {
      const res = await this.fetchFn(url, { method: 'GET', headers: this.headers() });
      if (!res.ok) return null;
      const body = (await res.json()) as { content?: string; encoding?: string };
      if (typeof body.content !== 'string') return null;
      if (body.encoding === 'base64') {
        return Buffer.from(body.content.replace(/\n/g, ''), 'base64').toString('utf8');
      }
      return body.content;
    } catch {
      return null;
    }
  }
}
