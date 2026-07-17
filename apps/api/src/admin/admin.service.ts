import { Injectable } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { QueueService } from '../queue/queue.service';
import { GraphService } from '../graph/graph.service';

type StoreStatus = {
  status: 'ok' | 'error';
  count?: number;
  detail?: string;
};

@Injectable()
export class AdminService {
  constructor(
    private db: DbService,
    private queue: QueueService,
    private graph: GraphService,
  ) {}

  async resetTestData(): Promise<{ status: string; cleared: Record<string, StoreStatus> }> {
    const cleared: Record<string, StoreStatus> = {};

    try {
      const drained = await this.queue.drainQueue();
      cleared.redis = { status: 'ok', count: drained };
    } catch (e) {
      cleared.redis = { status: 'error', detail: String(e) };
    }

    try {
      const deleted = await this.graph.clearAll();
      cleared.neo4j = { status: 'ok', count: deleted };
    } catch (e) {
      cleared.neo4j = { status: 'error', detail: String(e) };
    }

    try {
      await this.db.query(`
        TRUNCATE scan_runs, scan_jobs, rollout_plans, change_plans,
          lifecycle_requests, eol_risks, pattern_alerts, embedding_chunks, audit_log,
          parsed_blocks, data_sources, variables, outputs, provider_configs, remote_state_refs,
          pattern_stamps
        RESTART IDENTITY CASCADE
      `);
      const subRes = await this.db.query(`
        UPDATE subscriptions
        SET last_scan_at = NULL, last_scan_status = NULL, graph_node_count = 0
      `);
      cleared.postgres = { status: 'ok', count: subRes.rowCount ?? 0 };
    } catch (e) {
      cleared.postgres = { status: 'error', detail: String(e) };
    }

    try {
      const aiUrl = process.env.AI_SERVICE_URL || 'http://ai:8100';
      const res = await fetch(`${aiUrl}/admin/reset`, { method: 'POST' });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      }
      const body = await res.json().catch(() => ({}));
      cleared.ai = { status: 'ok', detail: typeof body === 'object' ? JSON.stringify(body) : String(body) };
    } catch (e) {
      cleared.ai = { status: 'error', detail: String(e) };
    }

    try {
      const job = await this.queue.enqueue({
        type: 'clear_artifacts',
        priority: 'P0',
        repo_id: '_system',
      });
      cleared.artifacts = { status: 'ok', detail: job.id };
    } catch (e) {
      cleared.artifacts = { status: 'error', detail: String(e) };
    }

    try {
      await this.db.query(
        `INSERT INTO audit_log (actor, action, details) VALUES ('admin', 'reset_test_data', $1::jsonb)`,
        [JSON.stringify(cleared)],
      );
      cleared.audit = { status: 'ok' };
    } catch (e) {
      cleared.audit = { status: 'error', detail: String(e) };
    }

    return { status: 'cleared', cleared };
  }
}
