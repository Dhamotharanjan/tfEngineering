import {
  Body,
  Controller,
  Headers,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { QueueService } from '../queue/queue.service';
import { DbService } from '../db/db.service';

@Controller('webhooks')
export class WebhooksController {
  constructor(private queue: QueueService, private db: DbService) {}

  @Post('github')
  async githubWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Body() body: any,
    @Headers('x-github-event') event: string,
    @Headers('x-hub-signature-256') signature: string | undefined,
    @Headers('x-github-delivery') deliveryId: string | undefined,
  ) {
    this.verifyGitHubSignature(req, body, signature);

    const rawName =
      body?.repository?.full_name ||
      body?.repository?.name ||
      '';
    const repoId = await this.resolveRepoId(rawName);
    const action = body?.action;

    const accepted = await this.recordDelivery(deliveryId, event, repoId, {
      action,
      ref: body?.ref,
      after: body?.after,
      before: body?.before,
    });
    if (!accepted) {
      return { accepted: true, deduped: true, delivery_id: deliveryId };
    }

    if (event === 'release' && body?.release?.tag_name) {
      if (!repoId) {
        return { accepted: true, skipped: 'unknown_repo', repository: rawName };
      }
      const sub = await this.db.query(
        `SELECT id, subscribed, role FROM subscriptions WHERE id=$1`,
        [repoId],
      );
      if (!sub.rows.length || !sub.rows[0].subscribed) {
        return { accepted: true, skipped: 'not_subscribed', repo_id: repoId };
      }
      const tag = body.release.tag_name;
      const job = await this.queue.enqueue({
        type: 'mandatory_impact_analysis',
        priority: 'P0',
        repo_id: repoId,
        payload: {
          to_version: tag,
          tag,
          from_version: body?.release?.target_commitish || 'v2.4.2',
          event: 'release',
          delivery_id: deliveryId,
          head_sha: body?.release?.target_commitish,
          release_name: body?.release?.name || tag,
          release_notes: body?.release?.body || '',
        },
      });
      await this.db.query(
        `INSERT INTO audit_log (actor, action, target) VALUES ('webhook', 'Release tag impact enqueued', $1)`,
        [tag],
      );
      return { accepted: true, job, repo_id: repoId };
    }

    if (event === 'push') {
      if (!repoId) {
        return { accepted: true, skipped: 'unknown_repo', repository: rawName };
      }
      const sub = await this.db.query(
        `SELECT id, subscribed FROM subscriptions WHERE id=$1`,
        [repoId],
      );
      if (!sub.rows.length || !sub.rows[0].subscribed) {
        return { accepted: true, skipped: 'not_subscribed', repo_id: repoId };
      }

      const { job, coalesce_count, enqueued } = await this.queue.enqueueCoalesced({
        type: 'incremental_scan',
        priority: 'P2',
        repo_id: repoId,
        payload: {
          trigger: 'webhook_push',
          head_sha: body?.after || undefined,
          before_sha: body?.before || undefined,
          ref: body?.ref,
          delivery_id: deliveryId,
          commits: Array.isArray(body?.commits) ? body.commits.length : 0,
        },
      });
      return {
        accepted: true,
        event: 'push',
        repo_id: repoId,
        job: enqueued ? job : null,
        coalesce_count,
        coalesced: !enqueued,
      };
    }

    if (event === 'pull_request' && (action === 'opened' || action === 'synchronize')) {
      if (!repoId) {
        return { accepted: true, skipped: 'unknown_repo' };
      }
      const job = await this.queue.enqueue({
        type: 'incremental_scan',
        priority: 'P2',
        repo_id: repoId,
        payload: {
          trigger: 'pull_request',
          head_sha: body?.pull_request?.head?.sha,
          before_sha: body?.pull_request?.base?.sha,
          pr_number: body?.number,
          delivery_id: deliveryId,
        },
      });
      return { accepted: true, event: 'pull_request', job, repo_id: repoId };
    }

    return { accepted: true, event, action, repo_id: repoId };
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
    const sub = await this.db.query(
      `SELECT id, subscribed FROM subscriptions WHERE id=$1`,
      [body.upstream_repo_id],
    );
    if (!sub.rows.length || !sub.rows[0].subscribed) {
      return { error: 'not_subscribed', repo_id: body.upstream_repo_id };
    }
    const to = body.to_version || 'v3.0.0';
    const job = await this.queue.enqueue({
      type: 'mandatory_impact_analysis',
      priority: 'P0',
      repo_id: body.upstream_repo_id,
      payload: {
        from_version: body.from_version || 'v2.4.2',
        to_version: to,
        tag: to,
        trigger: 'manual_ui',
        release_name: body.release_name || to,
        release_notes:
          body.release_notes ||
          `Manual impact trigger for ${to}. (Release notes not provided — webhook/API will fill when available.)`,
      },
    });
    return { job };
  }

  private verifyGitHubSignature(
    req: RawBodyRequest<Request>,
    body: any,
    signature: string | undefined,
  ) {
    const secret = process.env.GITHUB_WEBHOOK_SECRET || process.env.WEBHOOK_SECRET;
    if (!secret) {
      // Dev/demo: allow unsigned when secret unset
      return;
    }
    if (!signature?.startsWith('sha256=')) {
      throw new UnauthorizedException('missing X-Hub-Signature-256');
    }
    const rawBuf = req.rawBody || Buffer.from(JSON.stringify(body));
    const digest = createHmac('sha256', secret).update(rawBuf).digest('hex');
    const expected = Buffer.from(`sha256=${digest}`);
    const actual = Buffer.from(signature);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      throw new UnauthorizedException('invalid webhook signature');
    }
  }

  private async resolveRepoId(raw: string): Promise<string> {
    if (!raw) return '';
    const name = raw.includes('/') ? raw : raw;
    try {
      const res = await this.db.query(
        `SELECT id FROM subscriptions
         WHERE id=$1
            OR github_full_name=$1
            OR github_full_name=$2
            OR split_part(github_full_name, '/', 2) = $3
         LIMIT 1`,
        [raw, name, raw.includes('/') ? raw.split('/')[1] : raw],
      );
      if (res.rows.length) return res.rows[0].id;
    } catch {
      /* fall through */
    }
    // Fallback: strip owner prefix historically used in webhooks
    return raw.replace(/^acme\//, '').replace(/^.*\//, '') || raw;
  }

  private async recordDelivery(
    deliveryId: string | undefined,
    event: string,
    repoId: string,
    summary: Record<string, unknown>,
  ): Promise<boolean> {
    if (!deliveryId) return true;
    try {
      const res = await this.db.query(
        `INSERT INTO webhook_deliveries (delivery_id, provider, event_type, repo_id, payload_summary)
         VALUES ($1,'github',$2,$3,$4::jsonb)
         ON CONFLICT (delivery_id) DO NOTHING
         RETURNING delivery_id`,
        [deliveryId, event, repoId || null, JSON.stringify(summary)],
      );
      return (res.rowCount || 0) > 0;
    } catch {
      return true;
    }
  }
}
