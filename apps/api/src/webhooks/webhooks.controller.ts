import {
  Body,
  Controller,
  Headers,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { QueueService } from '../queue/queue.service';
import { DbService } from '../db/db.service';
import { ImpactLoopService } from '../platform/impact-loop.service';

@Controller('webhooks')
export class WebhooksController {
  constructor(
    private queue: QueueService,
    private db: DbService,
    private impactLoop: ImpactLoopService,
  ) {}

  @Post('github')
  async githubWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Body() body: any,
    @Headers('x-github-event') event: string,
    @Headers('x-hub-signature-256') signature: string | undefined,
    @Headers('x-github-delivery') deliveryId: string | undefined,
  ) {
    const secret = this.webhookSecret();
    this.assertSecretPolicy(secret);

    const headers: Record<string, string | undefined> = {
      'x-github-event': event,
      'x-hub-signature-256': signature,
      'x-github-delivery': deliveryId,
    };

    const rawName = body?.repository?.full_name || body?.repository?.name || '';
    const action = body?.action;

    // Dedup before routing (same delivery_id must not fan out twice).
    const accepted = await this.recordDelivery(deliveryId, event, rawName, {
      action,
      ref: body?.ref,
      after: body?.after,
      before: body?.before,
    });
    if (!accepted) {
      return { accepted: true, deduped: true, delivery_id: deliveryId };
    }

    const outcome = await this.impactLoop.handleGitHubWebhook(
      {
        headers,
        rawBody: req.rawBody || Buffer.alloc(0),
        body,
      },
      secret,
    );

    if (outcome.skipped) {
      return {
        accepted: true,
        skipped: outcome.skipped,
        event,
        action,
        repository: rawName,
      };
    }

    // COLD/WARM: job was enqueued for the worker (graph write path).
    if (outcome.enqueued) {
      return {
        accepted: true,
        event: outcome.event?.kind || event,
        path: outcome.job?.path,
        intent: outcome.job?.intent,
        repo_id: outcome.job?.repoId,
        job: {
          id: outcome.enqueued.id,
          type:
            outcome.job?.intent === 'cold_scan'
              ? 'full_scan'
              : outcome.job?.intent === 'warm_incremental'
                ? 'incremental_scan'
                : outcome.job?.intent,
          priority: outcome.job?.priority,
          repo_id: outcome.job?.repoId,
        },
      };
    }

    // HOT: PR / tag impact ran inline — read-only, no graph write.
    if (outcome.report) {
      await this.db.query(
        `INSERT INTO audit_log (actor, action, target) VALUES ('webhook', $1, $2)`,
        [
          outcome.job?.intent === 'tag_impact_query'
            ? 'Release tag HOT impact (platform)'
            : 'PR HOT impact (platform)',
          outcome.report.reportId,
        ],
      ).catch(() => undefined);
      return {
        accepted: true,
        event: outcome.event?.kind || event,
        path: 'HOT',
        intent: outcome.job?.intent,
        repo_id: outcome.job?.repoId,
        report: {
          report_id: outcome.report.reportId,
          silent: outcome.report.silent,
          impact_exists: outcome.report.impactExists,
          verdict: outcome.report.verdict,
          consumer_count: outcome.report.consumers?.length ?? 0,
        },
        // Explicit: never enqueue incremental_scan for PR/tag.
        graph_write: false,
      };
    }

    return {
      accepted: true,
      event,
      action,
      intent: outcome.job?.intent ?? null,
      path: outcome.job?.path ?? null,
    };
  }

  @Post('impact/trigger')
  async manualImpact(
    @Body()
    body: {
      upstream_repo_id: string;
      from_version?: string;
      to_version?: string;
      release_notes?: string;
      release_name?: string;
    },
  ) {
    const sub = await this.db.query(`SELECT id, subscribed FROM subscriptions WHERE id=$1`, [
      body.upstream_repo_id,
    ]);
    if (!sub.rows.length || !sub.rows[0].subscribed) {
      return { error: 'not_subscribed', repo_id: body.upstream_repo_id };
    }
    // No hardcoded version fallbacks — versions must come from the caller.
    if (!body.to_version) {
      return { error: 'to_version_required', repo_id: body.upstream_repo_id };
    }
    const job = await this.queue.enqueue({
      type: 'mandatory_impact_analysis',
      priority: 'P0',
      repo_id: body.upstream_repo_id,
      payload: {
        from_version: body.from_version || null,
        to_version: body.to_version,
        tag: body.to_version,
        trigger: 'manual_ui',
        release_name: body.release_name || body.to_version,
        release_notes: body.release_notes || '',
      },
    });
    return { job };
  }

  private webhookSecret(): string | undefined {
    return process.env.GITHUB_WEBHOOK_SECRET || process.env.WEBHOOK_SECRET || undefined;
  }

  private assertSecretPolicy(secret: string | undefined) {
    const requireSecret =
      process.env.IGCS_REQUIRE_WEBHOOK_SECRET === 'true' ||
      process.env.PLATFORM_REQUIRE_WEBHOOK_SECRET === 'true' ||
      process.env.NODE_ENV === 'production';
    if (!secret && requireSecret) {
      throw new UnauthorizedException(
        'GITHUB_WEBHOOK_SECRET is required (set IGCS_REQUIRE_WEBHOOK_SECRET=false only for local demo)',
      );
    }
  }

  private async recordDelivery(
    deliveryId: string | undefined,
    event: string,
    repoHint: string,
    summary: Record<string, unknown>,
  ): Promise<boolean> {
    if (!deliveryId) return true;
    try {
      const res = await this.db.query(
        `INSERT INTO webhook_deliveries (delivery_id, provider, event_type, repo_id, payload_summary)
         VALUES ($1,'github',$2,$3,$4::jsonb)
         ON CONFLICT (delivery_id) DO NOTHING
         RETURNING delivery_id`,
        [deliveryId, event, repoHint || null, JSON.stringify(summary)],
      );
      return (res.rowCount || 0) > 0;
    } catch {
      return true;
    }
  }
}
