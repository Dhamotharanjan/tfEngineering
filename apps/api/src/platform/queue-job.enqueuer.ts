import { Injectable } from '@nestjs/common';
import type { Job, JobEnqueuer } from '@infragraph/platform';
import { QueueService } from '../queue/queue.service';
import { platformIntentToWorkerType, toWorkerPayload } from './job-mapping';

/**
 * JobEnqueuer over the existing Redis queues.
 * cold_scan → full_scan, warm_incremental → incremental_scan.
 * HOT intents are rejected here (ImpactLoop runs them inline).
 */
@Injectable()
export class QueueJobEnqueuer implements JobEnqueuer {
  constructor(private readonly queue: QueueService) {}

  async enqueue(job: Job): Promise<Job> {
    const workerType = platformIntentToWorkerType(job.intent);
    if (!workerType) {
      throw new Error(
        `refusing to enqueue HOT intent ${job.intent} on the graph-writing worker queue`,
      );
    }
    const enqueued = await this.queue.enqueue({
      type: workerType,
      priority: job.priority,
      repo_id: job.repoId,
      payload: {
        ...toWorkerPayload(job.payload || {}),
        platform_intent: job.intent,
        platform_path: job.path,
      },
    });
    return { ...job, id: enqueued.id as string };
  }
}
