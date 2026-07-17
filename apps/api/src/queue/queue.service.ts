import { Injectable } from '@nestjs/common';
import Redis from 'ioredis';

export const QUEUE_KEY = 'infragraph:jobs';

@Injectable()
export class QueueService {
  private client: Redis;

  constructor() {
    const url = process.env.REDIS_URL || 'redis://localhost:6379/0';
    this.client = new Redis(url);
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

  async drainQueue(): Promise<number> {
    const len = await this.client.llen(QUEUE_KEY);
    if (len > 0) {
      await this.client.ltrim(QUEUE_KEY, 1, 0);
    }
    return len;
  }
}
