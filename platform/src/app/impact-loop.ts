import type { VcsProviderAdapter, RawWebhook } from '../integration/provider.ts';
import type { Job } from '../domain/jobs.ts';
import { JobIntent } from '../domain/jobs.ts';
import type { NormalizedVcsEvent } from '../domain/events.ts';
import { routeEvent } from '../integration/router.ts';
import type { PrFileFetcher } from '../integration/pr-files.ts';
import { resolvePrFiles } from '../integration/pr-files.ts';
import type { SubscriptionReader, JobEnqueuer } from '../ports/index.ts';
import { ImpactEngine } from '../impact/engine.ts';
import type { HotQueryInput } from '../impact/engine.ts';
import type { ImpactReport } from '../domain/impact.ts';
import type { PlatformConfig } from '../config/schema.ts';

export interface ImpactLoopDeps {
  subscriptions: SubscriptionReader;
  jobs: JobEnqueuer;
  engine: ImpactEngine;
  config: PlatformConfig;
  /** When set, HOT PR path fetches changed files if the webhook omitted them. */
  prFileFetcher?: PrFileFetcher | null;
}

export interface WebhookOutcome {
  event: NormalizedVcsEvent | null;
  job: Job | null;
  skipped?: 'unknown_provider_event' | 'unknown_repo' | 'not_subscribed' | 'ignored';
  // Populated for HOT jobs executed inline.
  report?: ImpactReport;
  // Populated for COLD/WARM jobs enqueued for the worker.
  enqueued?: Job;
}

// Thin orchestrator that ties routing to the two engines:
//   HOT  (pr/tag)  -> run the read-only ImpactEngine inline, return a report.
//   COLD/WARM      -> enqueue for the worker (which owns parsing + graph writes).
export class ImpactLoop {
  private deps: ImpactLoopDeps;
  constructor(deps: ImpactLoopDeps) {
    this.deps = deps;
  }

  async handleWebhook(adapter: VcsProviderAdapter, raw: RawWebhook, secret: string | undefined): Promise<WebhookOutcome> {
    adapter.verifySignature(raw, secret);
    let event = adapter.normalize(raw);
    if (!event) return { event: null, job: null, skipped: 'unknown_provider_event' };

    const sub = await this.deps.subscriptions.resolveByFullName(event.repoFullName);
    if (!sub) return { event, job: null, skipped: 'unknown_repo' };
    if (!sub.subscribed) return { event, job: null, skipped: 'not_subscribed' };

    const job = routeEvent(event, sub.id);
    if (!job) return { event, job: null, skipped: 'ignored' };

    // HOT PR: webhook payloads usually omit file lists — fetch via VCS API when needed.
    // Fetch failure → empty files (silent / no invented paths); never invent paths.
    if (job.intent === JobIntent.PR_IMPACT_QUERY) {
      const resolved = await resolvePrFiles(event, this.deps.prFileFetcher);
      event = resolved.event;
    }

    return this.dispatch(job, event);
  }

  async dispatch(job: Job, event?: NormalizedVcsEvent): Promise<WebhookOutcome> {
    if (job.intent === JobIntent.PR_IMPACT_QUERY || job.intent === JobIntent.TAG_IMPACT_QUERY) {
      const input = toHotInput(job, event);
      const report = await this.deps.engine.runHotQuery(input);
      return { event: event ?? null, job, report };
    }
    // COLD / WARM: hand off to the worker via the queue. This layer never parses
    // or writes the graph itself.
    const enqueued = await this.deps.jobs.enqueue(job);
    return { event: event ?? null, job, enqueued };
  }
}

function toHotInput(job: Job, event?: NormalizedVcsEvent): HotQueryInput {
  const p = job.payload;
  return {
    intent: job.intent as HotQueryInput['intent'],
    repoId: job.repoId,
    headSha: (p.headSha as string | null) ?? event?.headSha ?? null,
    files: event?.files,
    prNumber: (p.prNumber as number | undefined) ?? event?.prNumber,
    prAuthor: (p.prAuthor as string | undefined) ?? event?.prAuthor,
    tag: (p.tag as string | null) ?? event?.tag ?? null,
    toVersion: (p.toVersion as string | null) ?? null,
    fromVersion: (p.fromVersion as string | null) ?? null,
  };
}
