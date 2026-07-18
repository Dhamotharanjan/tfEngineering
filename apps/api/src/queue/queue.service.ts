import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';

export const QUEUE_KEY = 'infragraph:jobs';
const COALESCE_PREFIX = 'infragraph:coalesce:';

@Injectable()
export class QueueService implements OnModuleDestroy {
  private client: Redis;

  constructor() {
    const url = process.env.REDIS_URL || 'redis://localhost:6379/0';
    this.client = new Redis(url);
  }

  async onModuleDestroy() {
    await this.client.quit().catch(() => undefined);
  }

  async enqueue(job: {
    id?: string;
    type: string;
    priority: string;
    repo_id: string;
    payload?: Record<string, unknown>;
  }) {
    const payload = {
      id: job.id || `job-${Date.now()}`,
      type: job.type,
      priority: job.priority,
      repo_id: job.repo_id,
      payload: job.payload || {},
    };
    await this.client.lpush(QUEUE_KEY, JSON.stringify(payload));
    return payload;
  }

  /**
   * Coalesce bursty incremental_scan jobs per repo (Sourcegraph-style newer-supersedes).
   * First push in the window is enqueued; later pushes only bump the counter.
   */
  async enqueueCoalesced(
    job: {
      id?: string;
      type: string;
      priority: string;
      repo_id: string;
      payload?: Record<string, unknown>;
    },
    windowSec = Number(process.env.IGCS_COALESCE_SEC || 30),
  ): Promise<{ job: Record<string, unknown> | null; coalesce_count: number; enqueued: boolean }> {
    if (job.type !== 'incremental_scan') {
      const enqueued = await this.enqueue(job);
      return { job: enqueued, coalesce_count: 1, enqueued: true };
    }
    const key = `${COALESCE_PREFIX}${job.repo_id}`;
    const count = await this.client.incr(key);
    if (count === 1) {
      await this.client.expire(key, windowSec);
      const enqueued = await this.enqueue({
        ...job,
        payload: { ...(job.payload || {}), coalesced: true, coalesce_count: 1 },
      });
      return { job: enqueued, coalesce_count: 1, enqueued: true };
    }
    return { job: null, coalesce_count: count, enqueued: false };
  }

  async drainQueue(): Promise<number> {
    const len = await this.client.llen(QUEUE_KEY);
    if (len > 0) {
      await this.client.ltrim(QUEUE_KEY, 1, 0);
    }
    return len;
  }
}
