import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { DbService } from '../db/db.service';

@Controller('impact')
export class ImpactController {
  constructor(private db: DbService) {}

  @Get('reports/latest')
  async latest(@Query('upstream') upstream?: string) {
    const res = await this.db.query(
      `SELECT id, upstream_module, from_version, to_version, status, impact_report, created_at, updated_at
       FROM change_plans
       WHERE ($1::text IS NULL OR upstream_module ILIKE '%' || $1 || '%' OR id ILIKE '%' || $1 || '%')
       ORDER BY updated_at DESC NULLS LAST, created_at DESC
       LIMIT 1`,
      [upstream || null],
    );
    if (!res.rows.length) {
      return { message: 'No impact reports yet. Trigger release-tag analysis.' };
    }
    return this.hydrateReport(res.rows[0]);
  }

  @Get('reports/:id')
  async getReport(@Param('id') id: string) {
    const res = await this.db.query(
      `SELECT id, upstream_module, from_version, to_version, status, impact_report, created_at, updated_at
       FROM change_plans WHERE id=$1`,
      [id],
    );
    if (!res.rows.length) {
      return { error: 'not_found', id };
    }
    return this.hydrateReport(res.rows[0]);
  }

  @Post('reports/:id/chat')
  async chat(@Param('id') id: string, @Body() body: { message: string }) {
    const report: any = await this.getReport(id);
    if (report.error) return report;
    const message = (body?.message || '').trim();
    if (!message) return { error: 'message_required' };

    const aiUrl = process.env.AI_SERVICE_URL || 'http://localhost:8100';
    const context = {
      kind: 'release_impact',
      change_plan_id: report.id,
      upstream_module: report.upstream_module,
      from_version: report.from_version,
      to_version: report.to_version,
      tag: report.impact_report?.tag,
      release_name: report.impact_report?.release_name,
      release_notes: report.impact_report?.release_notes,
      contract_diff: report.impact_report?.contract_diff,
      breaking: report.impact_report?.breaking,
      downstream: report.downstream,
    };

    try {
      const res = await fetch(`${aiUrl}/release-compare/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message,
          analysis: context,
          history: [],
        }),
      });
      if (res.ok) {
        const data = await res.json();
        return {
          role: 'assistant',
          content: data.reply || data.message || data.content || JSON.stringify(data),
          source: 'ai',
        };
      }
    } catch {
      /* offline brief */
    }

    const breaking = report.impact_report?.breaking;
    const notes = report.impact_report?.release_notes;
    const dd = report.downstream || [];
    return {
      role: 'assistant',
      content: [
        `Impact brief for ${report.upstream_module} ${report.from_version} → ${report.to_version}.`,
        notes ? `Release notes excerpt:\n${String(notes).slice(0, 800)}` : null,
        breaking
          ? 'This is classified as a **breaking** change (removed vars, newly mandatory inputs, and/or version gap).'
          : 'No hard breaking contract flags detected; still review downstream pins.',
        `Affected downstream repos: ${dd.length}.`,
        dd
          .slice(0, 5)
          .map(
            (d: any) =>
              `- ${d.downstream_repo}: ${(d.locations || []).map((l: any) => `${l.directory || ''}/${l.file || ''}`.replace(/\/+/g, '/')).join(', ') || 'location TBD'}`,
          )
          .join('\n'),
        'Recommended: bump module ref, fill mandatory variables, run terragrunt plan, then apply with the suggested rollout strategy.',
        'Email notification for breaking changes is coming soon — details are available in-app.',
      ]
        .filter(Boolean)
        .join('\n\n'),
      source: 'offline_brief',
    };
  }

  private async hydrateReport(row: any) {
    const rollouts = await this.db.query(
      `SELECT id, downstream_repo, downstream_repo_id, pinned_version, target_version, strategy, strategy_reason,
              version_gap, breaking_changes, locations, status
       FROM rollout_plans WHERE change_plan_id=$1 ORDER BY created_at`,
      [row.id],
    );
    const impact_report =
      typeof row.impact_report === 'string' ? JSON.parse(row.impact_report || '{}') : row.impact_report || {};
    return {
      id: row.id,
      upstream_module: row.upstream_module,
      from_version: row.from_version,
      to_version: row.to_version,
      status: row.status,
      impact_report,
      breaking: Boolean(impact_report.breaking),
      created_at: row.created_at,
      updated_at: row.updated_at,
      downstream: rollouts.rows.map((r: any) => ({
        ...r,
        locations: typeof r.locations === 'string' ? JSON.parse(r.locations || '[]') : r.locations || [],
        breaking_changes:
          typeof r.breaking_changes === 'string'
            ? JSON.parse(r.breaking_changes || '[]')
            : r.breaking_changes || [],
      })),
      tree_path: `/dependencies?impact=${encodeURIComponent(row.id)}`,
    };
  }
}
