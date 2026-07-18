import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { QueueService } from '../queue/queue.service';
import * as fs from 'fs';
import * as path from 'path';

function loadCron(): string {
  try {
    const root = process.env.PROJECT_ROOT || '/app';
    const raw = fs.readFileSync(path.join(root, 'config', 'scan-profiles.json'), 'utf8');
    const json = JSON.parse(raw);
    return json?.triggers?.schedule?.full_reconcile_cron || '0 2 * * *';
  } catch {
    return '0 2 * * *';
  }
}

function nextRunFromCron(cron: string): string {
  const parts = cron.trim().split(/\s+/);
  const minute = Number(parts[0] ?? 0);
  const hour = Number(parts[1] ?? 2);
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hour, minute, 0));
  if (next.getTime() <= now.getTime()) {
    next.setUTCDate(next.getUTCDate() + 1);
  }
  return next.toISOString();
}

@Controller('scanner')
export class ScannerController {
  constructor(private db: DbService, private queue: QueueService) {}

  @Get('overview')
  async overview() {
    const cron = loadCron();
    const nextRun = nextRunFromCron(cron);
    const res = await this.db.query(
      `SELECT id, github_full_name, role, subscribed, scan_profile,
              last_scan_at, last_scan_status, last_scanned_sha, last_scanned_ref,
              last_incremental_at, last_full_scan_at, scan_stats, graph_node_count,
              COALESCE(triggers_enabled, '{}'::jsonb) AS triggers_enabled
       FROM subscriptions
       WHERE subscribed = true
       ORDER BY id`,
    );
    return {
      schedule: {
        full_reconcile_cron: cron,
        next_run_utc: nextRun,
        note: 'EOL/FinOps crons configured but not yet enforced',
      },
      repos: res.rows.map((r) => {
        const triggers = typeof r.triggers_enabled === 'string' ? JSON.parse(r.triggers_enabled) : r.triggers_enabled || {};
        const reconcileEnabled = triggers.reconcile_enabled !== false;
        return {
          id: r.id,
          name: r.github_full_name,
          role: r.role,
          scan_profile: r.scan_profile,
          last_scan_at: r.last_scan_at,
          last_scan_status: r.last_scan_status,
          last_scanned_sha: r.last_scanned_sha,
          last_scanned_ref: r.last_scanned_ref,
          last_incremental_at: r.last_incremental_at,
          last_full_scan_at: r.last_full_scan_at,
          scan_stats: r.scan_stats || {},
          graph_node_count: r.graph_node_count || 0,
          reconcile_enabled: reconcileEnabled,
          next_run_utc: reconcileEnabled ? nextRun : null,
          cron,
        };
      }),
    };
  }

  @Get('jobs')
  async jobs(@Query('limit') limit = '40') {
    const lim = Math.min(parseInt(String(limit), 10) || 40, 100);
    const res = await this.db.query(
      `SELECT j.id, j.job_type, j.priority, j.repo_id, j.status, j.payload, j.error_message,
              j.created_at, j.started_at, j.completed_at,
              (SELECT details FROM scan_runs sr WHERE sr.job_id = j.id ORDER BY sr.created_at DESC LIMIT 1) AS last_details,
              (SELECT stage FROM scan_runs sr WHERE sr.job_id = j.id ORDER BY sr.created_at DESC LIMIT 1) AS last_stage,
              m.mode, m.from_sha, m.to_sha, m.files_touched, m.parse_ms, m.graph_ms, m.coalesce_count
       FROM scan_jobs j
       LEFT JOIN LATERAL (
         SELECT mode, from_sha, to_sha, files_touched, parse_ms, graph_ms, coalesce_count
         FROM scan_metrics WHERE repo_id = j.repo_id ORDER BY created_at DESC LIMIT 1
       ) m ON true
       WHERE j.repo_id IS NULL OR j.repo_id IN (SELECT id FROM subscriptions WHERE subscribed = true)
          OR j.job_type IN ('mandatory_impact_analysis','module_impact_hint','reconcile_scan')
       ORDER BY j.created_at DESC
       LIMIT $1`,
      [lim],
    );
    return res.rows.map((r) => {
      const start = r.started_at || r.created_at;
      const end = r.completed_at;
      let duration_ms = null;
      if (start && end) {
        duration_ms = new Date(end).getTime() - new Date(start).getTime();
      }
      return {
        id: r.id,
        type: r.job_type,
        priority: r.priority,
        repo_id: r.repo_id,
        status: r.status,
        payload: r.payload,
        error_message: r.error_message,
        created_at: r.created_at,
        started_at: r.started_at,
        completed_at: r.completed_at,
        last_stage: r.last_stage,
        last_details: r.last_details,
        mode: r.mode || r.last_details?.mode || r.payload?.trigger || null,
        from_sha: r.from_sha || r.last_details?.from_sha || r.payload?.before_sha || null,
        to_sha: r.to_sha || r.last_details?.to_sha || r.payload?.head_sha || null,
        files_touched:
          r.files_touched ?? r.last_details?.files_touched?.length ?? r.last_details?.files_touched ?? null,
        parse_ms: r.parse_ms,
        graph_ms: r.graph_ms,
        coalesce_count: r.coalesce_count,
        duration_ms,
      };
    });
  }

  @Get('jobs/:id/runs')
  async jobRuns(@Param('id') id: string) {
    const [runs, job] = await Promise.all([
      this.db.query(
        `SELECT id, stage, status, nodes_written, edges_written, duration_ms, artifact_path, details, created_at
         FROM scan_runs WHERE job_id = $1 ORDER BY created_at ASC`,
        [id],
      ),
      this.db.query(
        `SELECT id, job_type, status, error_message, payload, created_at, started_at, completed_at, repo_id
         FROM scan_jobs WHERE id = $1`,
        [id],
      ),
    ]);
    return {
      job_id: id,
      job: job.rows[0] || null,
      error_message: job.rows[0]?.error_message || null,
      runs: runs.rows,
    };
  }

  @Post('reconcile')
  async reconcile() {
    const res = await this.db.query(
      `SELECT id FROM subscriptions WHERE subscribed = true
       AND COALESCE((triggers_enabled->>'reconcile_enabled')::boolean, true) = true`,
    );
    let n = 0;
    for (const row of res.rows) {
      await this.queue.enqueue({
        type: 'reconcile_scan',
        priority: 'P3',
        repo_id: row.id,
        payload: { trigger: 'reconcile_manual', scheduled_at: new Date().toISOString() },
      });
      n++;
    }
    return { enqueued: n };
  }
}
