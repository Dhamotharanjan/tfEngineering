import { Controller, Get } from '@nestjs/common';
import { DbService } from '../db/db.service';

@Controller('dashboard')
export class DashboardController {
  constructor(private db: DbService) {}

  @Get('stats')
  async stats() {
    const subs = await this.db.query(`SELECT count(*)::int AS c FROM subscriptions WHERE subscribed=true`);
    const plans = await this.db.query(`SELECT count(*)::int AS c FROM change_plans`);
    const eol = await this.db.query(`SELECT count(*)::int AS c FROM eol_risks`);
    const jobs = await this.db.query(`SELECT count(*)::int AS c FROM scan_jobs WHERE status='pending'`);
    return {
      subscribedRepos: subs.rows[0]?.c || 0,
      openPlans: plans.rows[0]?.c || 0,
      eolFlags: eol.rows[0]?.c || 0,
      pendingJobs: jobs.rows[0]?.c || 0,
      monthlySpend: 42800,
      extendedSupportCost: 1314,
    };
  }

  @Get('eol')
  async eol() {
    const res = await this.db.query(
      `SELECT repo_id, resource_ref, resource_type, current_version, risk, monthly_cost_usd, action FROM eol_risks ORDER BY detected_at DESC LIMIT 20`,
    );
    return res.rows.map((r) => ({
      repo: r.repo_id,
      resource: r.resource_ref,
      type: r.resource_type,
      version: r.current_version,
      risk: r.risk,
      monthlyCost: r.monthly_cost_usd,
      action: r.action,
    }));
  }

  @Get('audit')
  async audit() {
    const res = await this.db.query(
      `SELECT event_time, actor, action, target FROM audit_log ORDER BY event_time DESC LIMIT 20`,
    );
    return res.rows.map((r) => ({
      time: new Date(r.event_time).toISOString().replace('T', ' ').slice(0, 19),
      user: r.actor,
      action: r.action,
      target: r.target,
      ip: 'system',
    }));
  }
}
