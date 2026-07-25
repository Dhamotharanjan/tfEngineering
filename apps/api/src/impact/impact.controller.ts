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

  /** List recent HOT impact_reports (Phase 1 durable store). Optional repo_id filter. */
  @Get('reports')
  async listHotReports(
    @Query('repo_id') repoId?: string,
    @Query('limit') limitRaw?: string,
  ) {
    const limit = Math.min(Math.max(parseInt(limitRaw || '20', 10) || 20, 1), 100);
    const res = await this.db.query(
      `SELECT report_id, repo_id, intent, path, pr_number, tag, from_version, to_version,
              head_sha, verdict, silent, impact_exists, consumer_count,
              classification_summary, created_at
       FROM impact_reports
       WHERE ($1::text IS NULL OR repo_id = $1)
       ORDER BY created_at DESC
       LIMIT $2`,
      [repoId || null, limit],
    );
    return { reports: res.rows, count: res.rows.length };
  }

  @Get('reports/:id')
  async getReport(@Param('id') id: string) {
    // Phase 1 HOT reports (deep-link target) take precedence over legacy change_plans.
    const hot = await this.db.query(
      `SELECT report_id, repo_id, intent, event_kind, path, pr_number, tag,
              from_version, to_version, base_sha, head_sha, verdict, silent,
              impact_exists, consumer_count, consumers, evidence,
              classification_summary, pattern_checks, refresh_enqueued, report, created_at
       FROM impact_reports WHERE report_id = $1`,
      [id],
    );
    if (hot.rows.length) {
      return this.hydrateHotReport(hot.rows[0]);
    }

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

    if (report.path === 'HOT' || report.report_id) {
      return {
        role: 'assistant',
        content: [
          `HOT impact report ${report.report_id}: verdict=${report.verdict}, consumers=${report.consumer_count}.`,
          report.silent ? 'Silent (no IaC-relevant impact).' : null,
          `Classification: ${JSON.stringify(report.classification_summary || {})}.`,
          'Open the report deep link for full consumer evidence.',
        ]
          .filter(Boolean)
          .join('\n\n'),
        source: 'hot_report_brief',
      };
    }

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

  private hydrateHotReport(row: any) {
    const full =
      typeof row.report === 'string' ? JSON.parse(row.report || '{}') : row.report || {};
    return {
      report_id: row.report_id,
      id: row.report_id,
      path: row.path || 'HOT',
      repo_id: row.repo_id,
      intent: row.intent,
      event_kind: row.event_kind,
      pr_number: row.pr_number,
      tag: row.tag,
      from_version: row.from_version,
      to_version: row.to_version,
      base_sha: row.base_sha,
      head_sha: row.head_sha,
      verdict: row.verdict,
      silent: Boolean(row.silent),
      impact_exists: Boolean(row.impact_exists),
      consumer_count: row.consumer_count ?? 0,
      consumers: typeof row.consumers === 'string' ? JSON.parse(row.consumers || '[]') : row.consumers || [],
      evidence: typeof row.evidence === 'string' ? JSON.parse(row.evidence || '[]') : row.evidence || [],
      classification_summary:
        typeof row.classification_summary === 'string'
          ? JSON.parse(row.classification_summary || '{}')
          : row.classification_summary || {},
      pattern_checks:
        typeof row.pattern_checks === 'string'
          ? JSON.parse(row.pattern_checks || '[]')
          : row.pattern_checks || [],
      refresh_enqueued:
        typeof row.refresh_enqueued === 'string'
          ? JSON.parse(row.refresh_enqueued || '[]')
          : row.refresh_enqueued || [],
      report: full,
      created_at: row.created_at,
      tree_path: `/impact/reports/${encodeURIComponent(row.report_id)}`,
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
