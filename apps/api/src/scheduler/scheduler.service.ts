import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { QueueService } from '../queue/queue.service';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Enforces scan-profiles.json schedule.full_reconcile_cron (default nightly 02:00 UTC).
 * Lightweight ticker checks every minute — world-class reconcile-second pattern.
 */
@Injectable()
export class SchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(SchedulerService.name);
  private timer?: NodeJS.Timeout;
  private lastReconcileDay = '';

  constructor(private db: DbService, private queue: QueueService) {}

  onModuleInit() {
    if (process.env.IGCS_SCHEDULER === 'false') {
      this.log.log('IGCS scheduler disabled');
      return;
    }
    this.timer = setInterval(() => this.tick().catch((e) => this.log.warn(e?.message || e)), 60_000);
    this.log.log('IGCS reconcile scheduler started');
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private loadCronHourMinute(): { hour: number; minute: number } {
    try {
      const root = process.env.PROJECT_ROOT || '/app';
      const raw = fs.readFileSync(path.join(root, 'config', 'scan-profiles.json'), 'utf8');
      const json = JSON.parse(raw);
      const cron: string = json?.triggers?.schedule?.full_reconcile_cron || '0 2 * * *';
      const parts = cron.trim().split(/\s+/);
      const minute = Number(parts[0] ?? 0);
      const hour = Number(parts[1] ?? 2);
      return { hour: Number.isFinite(hour) ? hour : 2, minute: Number.isFinite(minute) ? minute : 0 };
    } catch {
      return { hour: 2, minute: 0 };
    }
  }

  private async tick() {
    const { hour, minute } = this.loadCronHourMinute();
    const now = new Date();
    const dayKey = now.toISOString().slice(0, 10);
    if (now.getUTCHours() !== hour || now.getUTCMinutes() !== minute) {
      return;
    }
    if (this.lastReconcileDay === dayKey) {
      return;
    }
    this.lastReconcileDay = dayKey;
    await this.enqueueReconcileAll();
  }

  /** Public for admin / tests */
  async enqueueReconcileAll() {
    const res = await this.db.query(
      `SELECT id FROM subscriptions
       WHERE subscribed=true
         AND COALESCE((triggers_enabled->>'reconcile_enabled')::boolean, true) = true`,
    );
    let n = 0;
    for (const row of res.rows) {
      await this.queue.enqueue({
        type: 'reconcile_scan',
        priority: 'P3',
        repo_id: row.id,
        payload: { trigger: 'reconcile', scheduled_at: new Date().toISOString() },
      });
      n++;
    }
    this.log.log(`Enqueued reconcile_scan for ${n} subscribed repos`);
    await this.db.query(
      `INSERT INTO audit_log (actor, action, target) VALUES ('scheduler', 'Full reconcile enqueued', $1)`,
      [`${n} repos`],
    );
    return { enqueued: n };
  }
}
