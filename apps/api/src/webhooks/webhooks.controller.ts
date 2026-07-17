import { Body, Controller, Headers, Post } from '@nestjs/common';
import { QueueService } from '../queue/queue.service';
import { DbService } from '../db/db.service';

@Controller('webhooks')
export class WebhooksController {
  constructor(private queue: QueueService, private db: DbService) {}

  @Post('github')
  async githubWebhook(
    @Body() body: any,
    @Headers('x-github-event') event: string,
  ) {
    const action = body?.action;
    if (event === 'release' && body?.release?.tag_name) {
      const repo = body?.repository?.name || 'upstream-core-network-modules';
      const tag = body.release.tag_name;
      const job = await this.queue.enqueue({
        type: 'mandatory_impact_analysis',
        priority: 'P0',
        repo_id: repo.replace('acme/', ''),
        payload: { to_version: tag, from_version: 'v2.4.2', event: 'release' },
      });
      await this.db.query(
        `INSERT INTO audit_log (actor, action, target) VALUES ('webhook', 'Release tag impact enqueued', $1)`,
        [tag],
      );
      return { accepted: true, job };
    }
    if (event === 'push') {
      const repo = body?.repository?.name;
      if (repo) {
        await this.queue.enqueue({ type: 'incremental_scan', priority: 'P2', repo_id: repo });
      }
      return { accepted: true, event: 'push' };
    }
    return { accepted: true, event, action };
  }

  @Post('impact/trigger')
  async manualImpact(
    @Body() body: { upstream_repo_id: string; from_version?: string; to_version?: string },
  ) {
    const job = await this.queue.enqueue({
      type: 'mandatory_impact_analysis',
      priority: 'P0',
      repo_id: body.upstream_repo_id,
      payload: {
        from_version: body.from_version || 'v2.4.2',
        to_version: body.to_version || 'v3.0.0',
      },
    });
    return { job };
  }
}
