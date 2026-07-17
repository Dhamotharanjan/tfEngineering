import { Controller, Get, Param, Query } from '@nestjs/common';
import { DbService } from '../db/db.service';

@Controller('plans')
export class PlansController {
  constructor(private db: DbService) {}

  @Get('change')
  async getChangePlan(@Query('id') id?: string) {
    const planId = id || 'cp-upstream-core-network-modules-v3-0-0';
    const res = await this.db.query(
      `SELECT id, upstream_module, from_version, to_version, status, phases, rollback FROM change_plans WHERE id=$1`,
      [planId],
    );
    if (!res.rows.length) {
      return {
        id: planId,
        title: 'Change Plan: awaiting impact analysis',
        status: 'draft',
        phases: [],
        rollback: 'Revert to last stable tag',
      };
    }
    const r = res.rows[0];
    return {
      id: r.id,
      title: `Change Plan: ${r.upstream_module} ${r.from_version} → ${r.to_version}`,
      status: r.status,
      phases: r.phases,
      rollback: r.rollback,
    };
  }

  @Get('rollout')
  async getRolloutPlan(@Query('change_plan_id') changePlanId?: string) {
    const res = await this.db.query(
      `SELECT downstream_repo, strategy, strategy_reason, phases, rollback, pinned_version, target_version
       FROM rollout_plans WHERE change_plan_id=$1 OR $1 IS NULL ORDER BY created_at DESC LIMIT 1`,
      [changePlanId || null],
    );
    if (!res.rows.length) {
      return { message: 'No rollout plans yet. Trigger mandatory impact analysis.' };
    }
    const r = res.rows[0];
    return {
      downstreamRepo: r.downstream_repo,
      strategy: r.strategy,
      strategyReason: r.strategy_reason,
      phases: r.phases,
      rollback: r.rollback,
      fromVersion: r.pinned_version,
      toVersion: r.target_version,
    };
  }

  @Get('rollout/all')
  async listRolloutPlans() {
    const res = await this.db.query(
      `SELECT id, downstream_repo, strategy, pinned_version, target_version, version_gap, status FROM rollout_plans ORDER BY created_at DESC`,
    );
    return res.rows;
  }
}
