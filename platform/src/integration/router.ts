import type { NormalizedVcsEvent } from '../domain/events.ts';
import { VcsEventKind } from '../domain/events.ts';
import type { Job, JobPriority } from '../domain/jobs.ts';
import { JobIntent, pathForIntent } from '../domain/jobs.ts';
import type { VcsProviderAdapter, RawWebhook } from './provider.ts';

// Provider registry. Add adapters here; unknown providers are rejected.
export class ProviderRegistry {
  private adapters = new Map<string, VcsProviderAdapter>();

  register(adapter: VcsProviderAdapter): this {
    this.adapters.set(adapter.provider, adapter);
    return this;
  }

  get(provider: string): VcsProviderAdapter | undefined {
    return this.adapters.get(provider);
  }
}

// The doctrine, expressed as pure routing. Given a normalized event and the
// resolved internal repo id, produce a job intent (or null to ignore).
//
//   push to default branch   -> warm_incremental (WARM, writes graph)
//   push to other branch     -> ignored (WARM only tracks default branch)
//   pull_request             -> pr_impact_query  (HOT, read-only)
//   tag/release              -> tag_impact_query (HOT, read-only)
//
// NOTE: a pull_request MUST NOT map to a graph-writing scan. That was the bug in
// apps/api (PR -> incremental_scan). Here PRs are structurally HOT-only.
export function routeEvent(event: NormalizedVcsEvent, repoId: string): Job | null {
  switch (event.kind) {
    case VcsEventKind.PUSH: {
      if (!event.isDefaultBranch) return null;
      return makeJob(JobIntent.WARM_INCREMENTAL, 'P2', repoId, {
        trigger: 'push_default_branch',
        headSha: event.headSha ?? null,
        baseSha: event.baseSha ?? null,
        ref: event.ref ?? null,
        deliveryId: event.deliveryId ?? null,
      });
    }
    case VcsEventKind.PULL_REQUEST: {
      return makeJob(JobIntent.PR_IMPACT_QUERY, 'P1', repoId, {
        trigger: 'pull_request',
        prNumber: event.prNumber ?? null,
        prAuthor: event.prAuthor ?? null,
        headSha: event.headSha ?? null,
        baseSha: event.baseSha ?? null,
        deliveryId: event.deliveryId ?? null,
      });
    }
    case VcsEventKind.TAG_RELEASE: {
      return makeJob(JobIntent.TAG_IMPACT_QUERY, 'P0', repoId, {
        trigger: 'release_tag',
        tag: event.tag ?? null,
        toVersion: event.tag ?? null,
        releaseName: event.releaseName ?? null,
        releaseNotes: event.releaseNotes ?? null,
        headSha: event.headSha ?? null,
        deliveryId: event.deliveryId ?? null,
      });
    }
    default:
      return null;
  }
}

// Subscribe / reconcile are not webhooks; they enter COLD explicitly from the UI
// or a reconcile scheduler. Kept here so all intent construction is in one place.
export function coldScanIntent(repoId: string, opts?: { trigger?: string; headSha?: string | null }): Job {
  return makeJob(JobIntent.COLD_SCAN, 'P2', repoId, {
    trigger: opts?.trigger ?? 'subscribe',
    headSha: opts?.headSha ?? null,
  });
}

// Convenience: verify + normalize + route in one call.
export function routeRawWebhook(
  adapter: VcsProviderAdapter,
  raw: RawWebhook,
  secret: string | undefined,
  resolveRepoId: (fullName: string) => string | null,
): { event: NormalizedVcsEvent | null; job: Job | null } {
  adapter.verifySignature(raw, secret);
  const event = adapter.normalize(raw);
  if (!event) return { event: null, job: null };
  const repoId = resolveRepoId(event.repoFullName);
  if (!repoId) return { event, job: null };
  return { event, job: routeEvent(event, repoId) };
}

function makeJob(intent: JobIntent, priority: JobPriority, repoId: string, payload: Record<string, unknown>): Job {
  return { intent, path: pathForIntent(intent), priority, repoId, payload };
}
