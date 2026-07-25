import { createHmac, timingSafeEqual } from 'node:crypto';
import type { VcsProviderAdapter, RawWebhook } from '../provider.ts';
import type { NormalizedVcsEvent, FileChange } from '../../domain/events.ts';
import { VcsEventKind } from '../../domain/events.ts';

// GitHub webhook adapter. Mirrors the verification + event handling in
// apps/api/src/webhooks/webhooks.controller.ts, but produces a normalized event
// and NEVER carries hardcoded demo defaults (no fallback versions/tags/repos).
export class GitHubAdapter implements VcsProviderAdapter {
  readonly provider = 'github';

  verifySignature(input: RawWebhook, secret: string | undefined): void {
    if (!secret) {
      // Caller decides whether to require a secret (see config.requireWebhookSecret).
      return;
    }
    const signature = input.headers['x-hub-signature-256'];
    if (!signature || !signature.startsWith('sha256=')) {
      throw new Error('missing X-Hub-Signature-256');
    }
    const raw = typeof input.rawBody === 'string' ? Buffer.from(input.rawBody) : input.rawBody;
    if (!raw || raw.length === 0) {
      throw new Error('raw body required for signature verification');
    }
    const digest = createHmac('sha256', secret).update(raw).digest('hex');
    const expected = Buffer.from(`sha256=${digest}`);
    const actual = Buffer.from(signature);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      throw new Error('invalid webhook signature');
    }
  }

  normalize(input: RawWebhook): NormalizedVcsEvent | null {
    const event = input.headers['x-github-event'];
    const body = input.body ?? {};
    const repoFullName: string = body?.repository?.full_name || body?.repository?.name || '';
    const deliveryId = input.headers['x-github-delivery'];
    const defaultBranch: string | undefined = body?.repository?.default_branch;
    const files = mapFiles(body);

    if (event === 'push') {
      const ref: string | undefined = body?.ref;
      const isDefaultBranch = Boolean(defaultBranch && ref === `refs/heads/${defaultBranch}`);
      return {
        provider: this.provider,
        kind: VcsEventKind.PUSH,
        repoFullName,
        deliveryId,
        defaultBranch,
        ref,
        headSha: body?.after || undefined,
        baseSha: body?.before || undefined,
        isDefaultBranch,
        files,
      };
    }

    if (event === 'pull_request') {
      const action = body?.action;
      if (action !== 'opened' && action !== 'synchronize' && action !== 'reopened') return null;
      return {
        provider: this.provider,
        kind: VcsEventKind.PULL_REQUEST,
        repoFullName,
        deliveryId,
        defaultBranch,
        prNumber: body?.number,
        prAuthor: body?.pull_request?.user?.login,
        headSha: body?.pull_request?.head?.sha,
        baseSha: body?.pull_request?.base?.sha,
        files,
      };
    }

    if (event === 'release' && body?.release?.tag_name) {
      return {
        provider: this.provider,
        kind: VcsEventKind.TAG_RELEASE,
        repoFullName,
        deliveryId,
        defaultBranch,
        tag: body?.release?.tag_name,
        headSha: body?.release?.target_commitish || undefined,
        releaseName: body?.release?.name || body?.release?.tag_name,
        releaseNotes: body?.release?.body || '',
        files,
      };
    }

    return null;
  }
}

function mapFiles(body: any): FileChange[] | undefined {
  // GitHub push payloads list added/modified/removed by path across commits.
  // File contents are fetched by the adapter layer elsewhere; here we only
  // surface the paths so the router can decide IaC-relevance offline.
  const commits: any[] = Array.isArray(body?.commits) ? body.commits : [];
  if (!commits.length) return undefined;
  const seen = new Map<string, FileChange>();
  for (const c of commits) {
    for (const p of c?.added || []) seen.set(p, { path: p, status: 'added' });
    for (const p of c?.modified || []) seen.set(p, { path: p, status: 'modified' });
    for (const p of c?.removed || []) seen.set(p, { path: p, status: 'removed' });
  }
  return [...seen.values()];
}
