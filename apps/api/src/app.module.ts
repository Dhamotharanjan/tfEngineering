import { Module } from '@nestjs/common';
import { HealthController } from './health/health.controller';
import { DbService } from './db/db.service';
import { QueueService } from './queue/queue.service';
import { SubscriptionsController } from './subscriptions/subscriptions.controller';
import { BlastRadiusController } from './blast-radius/blast-radius.controller';
import { PlansController } from './plans/plans.controller';
import { JobsController } from './jobs/jobs.controller';
import { WebhooksController } from './webhooks/webhooks.controller';
import { DashboardController } from './dashboard/dashboard.controller';
import { GraphService } from './graph/graph.service';
import { GraphController } from './graph/graph.controller';
import { PatternService } from './graph/pattern.service';
import { AdminController } from './admin/admin.controller';
import { AdminService } from './admin/admin.service';
import { ReleaseCompareController } from './release-compare/release-compare.controller';
import { ReleaseCompareService } from './release-compare/release-compare.service';
import { SchedulerService } from './scheduler/scheduler.service';
import { SchedulerController } from './scheduler/scheduler.controller';
import { ScannerController } from './scanner/scanner.controller';
import { ImpactController } from './impact/impact.controller';
import { PLATFORM_PROVIDERS } from './platform/platform.module';

@Module({
  imports: [],
  controllers: [
    HealthController,
    SubscriptionsController,
    BlastRadiusController,
    PlansController,
    JobsController,
    WebhooksController,
    DashboardController,
    AdminController,
    GraphController,
    ReleaseCompareController,
    SchedulerController,
    ScannerController,
    ImpactController,
  ],
  providers: [
    DbService,
    QueueService,
    GraphService,
    PatternService,
    AdminService,
    ReleaseCompareService,
    SchedulerService,
    ...PLATFORM_PROVIDERS,
  ],
})
export class AppModule {}
