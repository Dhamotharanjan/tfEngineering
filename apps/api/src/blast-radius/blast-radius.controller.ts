import { Controller, Get, Param, Query } from '@nestjs/common';
import { GraphService, GraphSlice } from '../graph/graph.service';
import { DbService } from '../db/db.service';

@Controller('blast-radius')
export class BlastRadiusController {
  constructor(private graph: GraphService, private db: DbService) {}

  @Get(':moduleId/graph')
  async getGraph(
    @Param('moduleId') moduleId: string,
    @Query('slice') slice?: GraphSlice,
    @Query('repoId') repoId?: string,
    @Query('depth') depth?: string,
  ) {
    const parsedDepth = depth ? parseInt(depth, 10) : 3;
    const [graphResult, counts, storeStatus] = await Promise.all([
      this.graph.getBlastRadiusGraph(moduleId, {
        slice: slice || 'component',
        repoId,
        depth: parsedDepth,
      }),
      this.graph.getCounts(moduleId, repoId),
      this.graph.getStoreStatus(),
    ]);

    return {
      graph: {
        nodes: graphResult.nodes,
        edges: graphResult.edges,
      },
      counts,
      store_status: graphResult.store_status || storeStatus,
      slice: graphResult.slice,
      module_id: graphResult.module_id,
      repo_id: graphResult.repo_id,
      depth: graphResult.depth ?? parsedDepth,
    };
  }

  @Get(':moduleId')
  async getBlastRadius(@Param('moduleId') moduleId: string) {
    const [summary, counts, storeStatus] = await Promise.all([
      this.graph.getSummary(moduleId),
      this.graph.getCounts(moduleId),
      this.graph.getStoreStatus(),
    ]);

    const [plans, upstream, pciStacks, finops] = await Promise.all([
      this.db.query(
        `SELECT downstream_repo, strategy, pinned_version, target_version, version_gap
         FROM rollout_plans
         WHERE change_plan_id IN (
           SELECT id FROM change_plans WHERE upstream_module = $1 OR upstream_module LIKE $2
         )
         ORDER BY created_at DESC LIMIT 10`,
        [moduleId, `%${moduleId}%`],
      ),
      this.db.query(
        `SELECT consumer_repo_id, upstream_repo_id, module_id, depth
         FROM upstream_lineage WHERE module_id = $1 OR module_id LIKE $2
         ORDER BY depth`,
        [moduleId, `%${moduleId}%`],
      ),
      this.db.query(
        `SELECT COUNT(DISTINCT s.id) AS c
         FROM subscriptions s
         JOIN upstream_lineage ul ON ul.consumer_repo_id = s.id
         WHERE (ul.module_id = $1 OR ul.module_id LIKE $2)
           AND s.compliance_scope @> '["pci"]'::jsonb`,
        [moduleId, `%${moduleId}%`],
      ).catch(() => ({ rows: [{ c: 0 }] })),
      this.db.query(
        `SELECT COALESCE(SUM(monthly_cost_usd), 0) AS total
         FROM eol_risks er
         JOIN upstream_lineage ul ON ul.consumer_repo_id = er.repo_id
         WHERE ul.module_id = $1 OR ul.module_id LIKE $2`,
        [moduleId, `%${moduleId}%`],
      ).catch(() => ({ rows: [{ total: 0 }] })),
    ]);

    return {
      module_id: summary.module_id,
      counts,
      store_status: storeStatus,
      impact: {
        stacks: counts.stacks,
        downstream_plans: plans.rows.length,
        upstream_consumers: upstream.rows.length,
        pci_stacks: Number(pciStacks.rows[0]?.c ?? 0),
        monthly_cost_usd: Number(finops.rows[0]?.total ?? 0),
      },
      downstream_plans: plans.rows,
      upstream_lineage: upstream.rows,
    };
  }
}
