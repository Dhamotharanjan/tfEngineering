import { Injectable, Logger, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import {
  createNarratorFromEnv,
  GitHubAdapter,
  GitHubPrFileFetcher,
  ImpactEngine,
  ImpactLoop,
  loadConfig,
  Neo4jGraphReader,
  PostgresContractStore,
  type RawWebhook,
  type WebhookOutcome,
} from '@infragraph/platform';
import { DbService } from '../db/db.service';
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

@Injectable()
export class ImpactLoopService implements OnModuleInit {
  private readonly log = new Logger(ImpactLoopService.name);
  private loop!: ImpactLoop;
  private readonly github = new GitHubAdapter();

  constructor(
    private readonly db: DbService,
    private readonly subscriptions: DbSubscriptionReader,
    private readonly jobs: QueueJobEnqueuer,
    private readonly cypher: NestCypherRunner,
    private readonly watermarks: Phase0WatermarkStore,
    private readonly reports: Phase0ImpactReportStore,
    private readonly patterns: EmptyPatternStore,
    private readonly audit: Phase0AuditStore,
    private readonly notifier: LogNotifier,
  ) {}

  onModuleInit() {
    const config = loadConfig(process.env);
    const sql = {
      query: <T = any>(text: string, params?: unknown[]) => this.db.query(text, params as any[]),
    };
    const narrator = createNarratorFromEnv(process.env);
    const prFileFetcher = GitHubPrFileFetcher.fromEnv(process.env);
    const engine = new ImpactEngine({
      graph: new Neo4jGraphReader(this.cypher),
      subscriptions: this.subscriptions,
      contracts: new PostgresContractStore(sql),
      watermarks: this.watermarks,
      patterns: this.patterns,
      reports: this.reports,
      jobs: this.jobs,
      notifier: this.notifier,
      narrator,
      config,
    });
    this.loop = new ImpactLoop({
      subscriptions: this.subscriptions,
      jobs: this.jobs,
      engine,
      config,
      prFileFetcher,
    });
    this.log.log(
      'ImpactLoop wired (Phase 2: PR file fetch + evidence-only AI narrator w/ TemplateNarrator fallback)',
    );
  }

  async handleGitHubWebhook(raw: RawWebhook, secret: string | undefined): Promise<WebhookOutcome> {
    try {
      return await this.loop.handleWebhook(this.github, raw, secret);
    } catch (e: any) {
      const msg = String(e?.message || e);
      if (
        msg.includes('signature') ||
        msg.includes('X-Hub-Signature') ||
        msg.includes('raw body required')
      ) {
        throw new UnauthorizedException(msg);
      }
      throw e;
    }
  }
}
