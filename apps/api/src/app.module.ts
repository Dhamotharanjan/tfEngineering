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
  ],
  providers: [DbService, QueueService, GraphService, PatternService, AdminService, ReleaseCompareService],
})
export class AppModule {}
