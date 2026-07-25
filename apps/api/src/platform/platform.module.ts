import { Module } from '@nestjs/common';
import { ImpactLoopService } from './impact-loop.service';
import { DbSubscriptionReader } from './db-subscription.reader';
import { QueueJobEnqueuer } from './queue-job.enqueuer';
import { NestCypherRunner } from './nest-cypher.runner';
import {
  EmptyPatternStore,
  LogNotifier,
  Phase0AuditStore,
  Phase0ImpactReportStore,
  Phase0WatermarkStore,
} from './phase0-stores';

/** Providers that wire @infragraph/platform into the Nest API (Phase 0–3). */
export const PLATFORM_PROVIDERS = [
  DbSubscriptionReader,
  QueueJobEnqueuer,
  NestCypherRunner,
  Phase0WatermarkStore,
  Phase0ImpactReportStore,
  Phase0AuditStore,
  EmptyPatternStore,
  /** Kept for tests / fallback; live HOT path uses GitHubNotifier in ImpactLoopService. */
  LogNotifier,
  ImpactLoopService,
];

/** Optional Nest module export for tests / future feature modules. */
@Module({
  providers: PLATFORM_PROVIDERS,
  exports: PLATFORM_PROVIDERS,
})
export class PlatformModule {}
