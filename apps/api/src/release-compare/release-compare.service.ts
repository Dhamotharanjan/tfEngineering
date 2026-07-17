import { Injectable, OnModuleInit } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { QueueService } from '../queue/queue.service';
import * as fs from 'fs';
import * as path from 'path';

export type ContractVar = {
  name: string;
  type?: string | null;
  default?: unknown;
  sensitive?: boolean;
  description?: string | null;
};

export type ContractOutput = {
  name: string;
  sensitive?: boolean;
  description?: string | null;
};

type SeedModule = {
  module_id: string;
  module_source?: string;
  display_name?: string;
  github_full_name?: string;
  source_match?: string[];
  releases: Array<{
    version: string;
    released_at?: string;
    variables: ContractVar[];
    outputs?: ContractOutput[];
  }>;
};

type SeedFile = { modules: SeedModule[] };

function hasDefault(v: ContractVar): boolean {
  return v.default !== undefined && v.default !== null;
}

function isMandatory(v: ContractVar): boolean {
  return !hasDefault(v);
}

function defaultsEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function normalizeVar(v: any): ContractVar {
  return {
    name: v.name,
    type: v.type ?? v.var_type ?? null,
    default: v.default !== undefined ? v.default : v.default_json ?? null,
    sensitive: Boolean(v.sensitive),
    description: v.description ?? null,
  };
}

@Injectable()
export class ReleaseCompareService implements OnModuleInit {
  private seedMeta = new Map<string, SeedModule>();

  constructor(private db: DbService, private queue: QueueService) {}

  async onModuleInit() {
    await this.ensureSeeded();
  }

  private seedPath() {
    return path.join(
      process.env.PROJECT_ROOT || '/app',
      'config',
      'release-contracts',
      'seed.json',
    );
  }

  private loadSeedFile(): SeedFile | null {
    const p = this.seedPath();
    if (!fs.existsSync(p)) return null;
    try {
      return JSON.parse(fs.readFileSync(p, 'utf8')) as SeedFile;
    } catch (e: any) {
      console.warn('release-contracts seed load failed:', e.message);
      return null;
    }
  }

  async ensureSeeded() {
    const seed = this.loadSeedFile();
    if (!seed?.modules?.length) return;

    for (const mod of seed.modules) {
      this.seedMeta.set(mod.module_id, mod);
      for (const rel of mod.releases || []) {
        const id = `${mod.module_id}@${rel.version}`;
        await this.db.query(
          `INSERT INTO module_release_contracts
             (id, module_id, module_source, version, display_name, variables, outputs, source_kind, released_at)
           VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,'seed',$8)
           ON CONFLICT (module_id, version) DO UPDATE SET
             module_source = EXCLUDED.module_source,
             display_name = EXCLUDED.display_name,
             variables = EXCLUDED.variables,
             outputs = EXCLUDED.outputs,
             source_kind = EXCLUDED.source_kind,
             released_at = EXCLUDED.released_at`,
          [
            id,
            mod.module_id,
            mod.module_source || null,
            rel.version,
            mod.display_name || mod.module_id,
            JSON.stringify(rel.variables || []),
            JSON.stringify(rel.outputs || []),
            rel.released_at || null,
          ],
        );
      }
    }
  }

  private matchPatterns(moduleId: string): string[] {
    const meta = this.seedMeta.get(moduleId);
    const patterns = new Set<string>([moduleId]);
    if (meta?.module_source) patterns.add(meta.module_source);
    for (const m of meta?.source_match || []) patterns.add(m);
    return [...patterns];
  }

  async listModules() {
    await this.ensureSeeded();
    const contracts = await this.db.query(
      `SELECT module_id, display_name, module_source,
              array_agg(version ORDER BY released_at NULLS LAST, version) AS versions,
              count(*)::int AS release_count,
              max(released_at) AS latest_released_at
       FROM module_release_contracts
       GROUP BY module_id, display_name, module_source
       ORDER BY display_name`,
    );

    const subs = await this.db.query(
      `SELECT id, github_full_name, role, subscribed
       FROM subscriptions WHERE role = 'module_source' ORDER BY id`,
    );
    const subById = new Map(subs.rows.map((r) => [r.id, r]));

    const consumerCounts = await this.db.query(
      `SELECT consumer_repo_id, module_id, upstream_repo_id FROM upstream_lineage`,
    );

    return contracts.rows.map((row) => {
      const sub = subById.get(row.module_id);
      const patterns = this.matchPatterns(row.module_id);
      const consumers = new Set<string>();
      for (const c of consumerCounts.rows) {
        if (
          c.upstream_repo_id === row.module_id ||
          patterns.some((p) => String(c.module_id || '').includes(p))
        ) {
          consumers.add(c.consumer_repo_id);
        }
      }
      return {
        module_id: row.module_id,
        display_name: row.display_name,
        module_source: row.module_source,
        github_full_name: sub?.github_full_name || this.seedMeta.get(row.module_id)?.github_full_name,
        versions: row.versions || [],
        release_count: row.release_count,
        latest_released_at: row.latest_released_at,
        subscribed: sub?.subscribed ?? false,
        consumer_count: consumers.size,
      };
    });
  }

  async listReleases(moduleId: string) {
    await this.ensureSeeded();
    const res = await this.db.query(
      `SELECT version, display_name, module_source, source_kind, released_at,
              jsonb_array_length(variables) AS variable_count,
              jsonb_array_length(outputs) AS output_count
       FROM module_release_contracts
       WHERE module_id = $1
       ORDER BY released_at NULLS LAST, version`,
      [moduleId],
    );

    const pins = await this.pinDistribution(moduleId);
    return {
      module_id: moduleId,
      releases: res.rows.map((r) => ({
        version: r.version,
        display_name: r.display_name,
        module_source: r.module_source,
        source_kind: r.source_kind,
        released_at: r.released_at,
        variable_count: r.variable_count,
        output_count: r.output_count,
        consumer_pin_count: pins[r.version] || 0,
      })),
      pin_distribution: pins,
      suggested_from: this.suggestFromVersion(pins, res.rows.map((r) => r.version)),
      suggested_to: res.rows.length ? res.rows[res.rows.length - 1].version : null,
    };
  }

  private suggestFromVersion(
    pins: Record<string, number>,
    versions: string[],
  ): string | null {
    const versionSet = new Set(versions);
    const entries = Object.entries(pins)
      .filter(([pin]) => pin !== 'unpinned' && pin !== 'unknown' && versionSet.has(pin))
      .sort((a, b) => b[1] - a[1]);
    if (entries.length) return entries[0][0];
    // Prefer a pin that exists in the wild even if not in contract set
    const anyPinned = Object.entries(pins)
      .filter(([pin]) => pin !== 'unpinned' && pin !== 'unknown')
      .sort((a, b) => b[1] - a[1]);
    if (anyPinned.length && versionSet.has(anyPinned[0][0])) return anyPinned[0][0];
    if (versions.length >= 2) return versions[versions.length - 2];
    return versions[0] || null;
  }

  async pinDistribution(moduleId: string): Promise<Record<string, number>> {
    const patterns = this.matchPatterns(moduleId);
    const refs = await this.db.query(
      `SELECT COALESCE(NULLIF(ref, ''), NULLIF(version, ''), 'unpinned') AS pin, count(*)::int AS c
       FROM module_references
       WHERE ${patterns.map((_, i) => `module_source ILIKE $${i + 1}`).join(' OR ')}
          OR module_source = $${patterns.length + 1}
       GROUP BY 1`,
      [...patterns.map((p) => `%${p}%`), moduleId],
    );
    const out: Record<string, number> = {};
    for (const r of refs.rows) out[r.pin] = r.c;
    return out;
  }

  private async loadContract(moduleId: string, version: string) {
    const res = await this.db.query(
      `SELECT * FROM module_release_contracts WHERE module_id = $1 AND version = $2`,
      [moduleId, version],
    );
    if (res.rows.length) {
      const row = res.rows[0];
      return {
        module_id: row.module_id,
        version: row.version,
        display_name: row.display_name,
        module_source: row.module_source,
        source_kind: row.source_kind,
        variables: (row.variables || []).map(normalizeVar),
        outputs: row.outputs || [],
      };
    }

    // Live fallback: current scanned variables for the upstream repo (single version snapshot).
    const live = await this.db.query(
      `SELECT name, var_type, default_json, sensitive, description FROM variables WHERE repo_id = $1 ORDER BY name`,
      [moduleId],
    );
    if (live.rows.length) {
      return {
        module_id: moduleId,
        version,
        display_name: moduleId,
        module_source: null,
        source_kind: 'live_scan',
        variables: live.rows.map((v) =>
          normalizeVar({
            name: v.name,
            type: v.var_type,
            default: v.default_json,
            sensitive: v.sensitive,
            description: v.description,
          }),
        ),
        outputs: (
          await this.db.query(
            `SELECT name, sensitive, value_ref AS description FROM outputs WHERE repo_id = $1 ORDER BY name`,
            [moduleId],
          )
        ).rows,
      };
    }
    return null;
  }

  diffContracts(from: { variables: ContractVar[]; outputs: ContractOutput[] }, to: {
    variables: ContractVar[];
    outputs: ContractOutput[];
  }) {
    const fromVars = new Map(from.variables.map((v) => [v.name, v]));
    const toVars = new Map(to.variables.map((v) => [v.name, v]));

    const added: ContractVar[] = [];
    const removed: ContractVar[] = [];
    const made_mandatory: Array<{ name: string; from: ContractVar; to: ContractVar }> = [];
    const changed: Array<{
      name: string;
      changes: string[];
      from: ContractVar;
      to: ContractVar;
    }> = [];

    for (const [name, tv] of toVars) {
      const fv = fromVars.get(name);
      if (!fv) {
        added.push(tv);
        continue;
      }
      const changes: string[] = [];
      if ((fv.type || null) !== (tv.type || null)) changes.push('type');
      if (!defaultsEqual(fv.default, tv.default)) changes.push('default');
      if ((fv.description || '') !== (tv.description || '')) changes.push('description');
      if (Boolean(fv.sensitive) !== Boolean(tv.sensitive)) changes.push('sensitive');

      if (!isMandatory(fv) && isMandatory(tv)) {
        made_mandatory.push({ name, from: fv, to: tv });
      } else if (changes.length) {
        changed.push({ name, changes, from: fv, to: tv });
      }
    }

    for (const [name, fv] of fromVars) {
      if (!toVars.has(name)) removed.push(fv);
    }

    const fromOut = new Map((from.outputs || []).map((o) => [o.name, o]));
    const toOut = new Map((to.outputs || []).map((o) => [o.name, o]));
    const outputs_added = [...toOut.values()].filter((o) => !fromOut.has(o.name));
    const outputs_removed = [...fromOut.values()].filter((o) => !toOut.has(o.name));

    return {
      variables: { added, removed, made_mandatory, changed },
      outputs: { added: outputs_added, removed: outputs_removed },
      summary: {
        added: added.length,
        removed: removed.length,
        made_mandatory: made_mandatory.length,
        changed: changed.length,
        outputs_added: outputs_added.length,
        outputs_removed: outputs_removed.length,
        breaking:
          removed.length +
          made_mandatory.length +
          added.filter(isMandatory).length,
      },
    };
  }

  private classifyImpact(
    pin: string,
    fromVersion: string,
    toVersion: string,
    diff: ReturnType<ReleaseCompareService['diffContracts']>,
    providedInputs: string[],
  ) {
    const missingMandatory = diff.variables.made_mandatory
      .map((m) => m.name)
      .filter((n) => !providedInputs.includes(n));
    const missingNewRequired = diff.variables.added
      .filter(isMandatory)
      .map((v) => v.name)
      .filter((n) => !providedInputs.includes(n));
    const usesRemoved = diff.variables.removed
      .map((v) => v.name)
      .filter((n) => providedInputs.includes(n));

    const actions: string[] = [];
    let severity: 'critical' | 'high' | 'medium' | 'low' | 'none' = 'none';

    if (pin === fromVersion || pin === 'unpinned') {
      if (missingMandatory.length || missingNewRequired.length || usesRemoved.length) {
        severity = 'critical';
        if (missingMandatory.length) {
          actions.push(`Set newly mandatory inputs: ${missingMandatory.join(', ')}`);
        }
        if (missingNewRequired.length) {
          actions.push(`Provide new required variables: ${missingNewRequired.join(', ')}`);
        }
        if (usesRemoved.length) {
          actions.push(`Remove obsolete inputs: ${usesRemoved.join(', ')}`);
        }
      } else if (diff.summary.added || diff.summary.changed || diff.summary.outputs_added) {
        severity = diff.summary.breaking ? 'high' : 'medium';
        actions.push(`Bump pin ${fromVersion} → ${toVersion} and review optional new inputs`);
      } else {
        severity = 'low';
        actions.push(`Bump pin ${fromVersion} → ${toVersion}`);
      }
      actions.push('Open PR to update module source ref');
    } else if (pin === toVersion) {
      severity = 'none';
      actions.push('Already on target version');
    } else {
      severity = 'medium';
      actions.push(`Pinned at ${pin}; evaluate path to ${toVersion}`);
      if (diff.summary.breaking) {
        actions.push('Review breaking interface changes before upgrading');
      }
    }

    return {
      severity,
      missing_mandatory: missingMandatory,
      missing_new_required: missingNewRequired,
      uses_removed: usesRemoved,
      suggested_actions: actions,
    };
  }

  async compare(moduleId: string, fromVersion: string, toVersion: string) {
    await this.ensureSeeded();
    const from = await this.loadContract(moduleId, fromVersion);
    const to = await this.loadContract(moduleId, toVersion);
    if (!from || !to) {
      return {
        error: 'contract_not_found',
        module_id: moduleId,
        from_version: fromVersion,
        to_version: toVersion,
        missing: [!from && fromVersion, !to && toVersion].filter(Boolean),
      };
    }

    const diff = this.diffContracts(from, to);
    const patterns = this.matchPatterns(moduleId);

    const refs = await this.db.query(
      `SELECT mr.repo_id, mr.stack_file, mr.module_source, mr.ref, mr.version, mr.file, mr.line,
              s.github_full_name, s.role
       FROM module_references mr
       LEFT JOIN subscriptions s ON s.id = mr.repo_id
       WHERE ${patterns.map((_, i) => `mr.module_source ILIKE $${i + 1}`).join(' OR ')}
          OR mr.module_source = $${patterns.length + 1}
          OR mr.repo_id IN (
            SELECT consumer_repo_id FROM upstream_lineage WHERE upstream_repo_id = $${patterns.length + 2}
          )
       ORDER BY mr.repo_id, mr.stack_file`,
      [...patterns.map((p) => `%${p}%`), moduleId, moduleId],
    );

    // Also include watched consumers even if pin source string differs.
    const watched = await this.db.query(
      `SELECT id, github_full_name, role, module_sources_watched
       FROM subscriptions
       WHERE role = 'downstream_consumer'
         AND (
           module_sources_watched::text ILIKE $1
           OR id IN (SELECT consumer_repo_id FROM upstream_lineage WHERE upstream_repo_id = $2)
         )`,
      [`%${moduleId}%`, moduleId],
    );

    const byRepo = new Map<
      string,
      {
        repo_id: string;
        github_full_name?: string;
        stacks: Array<{ stack_file: string | null; pin: string; module_source: string }>;
        pin: string;
      }
    >();

    for (const r of refs.rows) {
      if (r.repo_id === moduleId) continue;
      if (r.role === 'module_source') continue;
      // Relative path refs between sibling upstream samples are not consumers.
      if (String(r.module_source || '').startsWith('../')) continue;
      const pin = r.ref || r.version || 'unpinned';
      const entry = byRepo.get(r.repo_id) || {
        repo_id: r.repo_id,
        github_full_name: r.github_full_name,
        stacks: [],
        pin,
      };
      entry.stacks.push({
        stack_file: r.stack_file,
        pin,
        module_source: r.module_source,
      });
      entry.pin = pin;
      byRepo.set(r.repo_id, entry);
    }

    for (const w of watched.rows) {
      if (!byRepo.has(w.id)) {
        byRepo.set(w.id, {
          repo_id: w.id,
          github_full_name: w.github_full_name,
          stacks: [],
          pin: 'unknown',
        });
      }
    }

    const consumers = [];
    for (const entry of byRepo.values()) {
      const inputsRes = await this.db.query(
        `SELECT DISTINCT key FROM config_values WHERE repo_id = $1 AND scope = 'stack'`,
        [entry.repo_id],
      );
      const providedInputs = inputsRes.rows.map((r) => r.key);
      const impact = this.classifyImpact(
        entry.pin,
        fromVersion,
        toVersion,
        diff,
        providedInputs,
      );
      consumers.push({
        repo_id: entry.repo_id,
        github_full_name: entry.github_full_name || entry.repo_id,
        current_pin: entry.pin,
        stacks: entry.stacks,
        stack_count: entry.stacks.length || 1,
        provided_inputs: providedInputs,
        ...impact,
        blast_radius_path: `/impact/${encodeURIComponent(moduleId)}`,
        lineage_hint: `slice=lineage&repoId=${encodeURIComponent(entry.repo_id)}`,
      });
    }

    const severityRank = { critical: 0, high: 1, medium: 2, low: 3, none: 4 };
    consumers.sort(
      (a, b) => (severityRank[a.severity] ?? 9) - (severityRank[b.severity] ?? 9) || a.repo_id.localeCompare(b.repo_id),
    );

    const pinsOnFrom = consumers.filter((c) => c.current_pin === fromVersion || c.current_pin === 'unpinned');

    return {
      module_id: moduleId,
      display_name: from.display_name || to.display_name,
      module_source: from.module_source || to.module_source,
      from_version: fromVersion,
      to_version: toVersion,
      from_source_kind: from.source_kind,
      to_source_kind: to.source_kind,
      diff,
      from_contract: { variable_count: from.variables.length, output_count: from.outputs.length },
      to_contract: { variable_count: to.variables.length, output_count: to.outputs.length },
      consumers,
      impact_summary: {
        consumer_count: consumers.length,
        on_from_version: pinsOnFrom.length,
        critical: consumers.filter((c) => c.severity === 'critical').length,
        high: consumers.filter((c) => c.severity === 'high').length,
        medium: consumers.filter((c) => c.severity === 'medium').length,
        already_on_target: consumers.filter((c) => c.current_pin === toVersion).length,
      },
    };
  }

  async raisePr(body: {
    repo_id: string;
    module_id: string;
    from_version: string;
    to_version: string;
    title?: string;
    body?: string;
    dry_run?: boolean;
    skip_analysis?: boolean;
  }) {
    const title =
      body.title ||
      `chore(infra): bump ${body.module_id} ${body.from_version} → ${body.to_version}`;
    const prBody =
      body.body ||
      [
        `## Release compare upgrade`,
        ``,
        `Bump \`${body.module_id}\` from \`${body.from_version}\` to \`${body.to_version}\`.`,
        ``,
        `Generated by InfraGraph Release Compare.`,
        `Review AI recommendations and obtain git approver sign-off before merge.`,
      ].join('\n');

    const payload = {
      repo_id: body.repo_id,
      module_id: body.module_id,
      from_version: body.from_version,
      to_version: body.to_version,
      title,
      body: prBody,
      dry_run: Boolean(body.dry_run),
    };

    // 1) pending_analysis — gather context + call AI (realtime AWS docs when reachable)
    let analysis: any = { status: 'pending' };
    const context = await this.gatherAnalysisContext(body);
    analysis = await this.callAiAnalyze(context);
    analysis.context = {
      resource_count: context.resources.length,
      diff_summary: context.diff_summary,
      config_hints: context.config_hints?.length || 0,
    };

    const approvalState = 'awaiting_approval';
    const status = 'awaiting_approval';
    const mode = 'scaffold';
    const message =
      'AI recommendations ready. Git approver approval required before the PR can be queued/opened.';
    const prUrl: string | null = null;
    const jobId: string | null = null;

    const inserted = await this.db.query(
      `INSERT INTO pr_draft_requests
         (repo_id, module_id, from_version, to_version, status, mode, pr_url, message, payload, analysis, approval_state, job_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11,$12)
       RETURNING *`,
      [
        body.repo_id,
        body.module_id,
        body.from_version,
        body.to_version,
        status,
        mode,
        prUrl,
        message,
        JSON.stringify(payload),
        JSON.stringify(analysis),
        approvalState,
        jobId,
      ],
    );

    await this.db.query(
      `INSERT INTO audit_log (actor, action, target) VALUES ('api', 'Raise PR analyzed — awaiting approval', $1)`,
      [`${body.repo_id} ${body.from_version}→${body.to_version}`],
    );

    return this.formatPrRequest(inserted.rows[0]);
  }

  private formatPrRequest(row: any) {
    const analysis = row.analysis || {};
    const rec = analysis.recommendations || analysis;
    const chatMessages = Array.isArray(row.chat_messages)
      ? row.chat_messages
      : typeof row.chat_messages === 'string'
        ? (() => {
            try {
              return JSON.parse(row.chat_messages);
            } catch {
              return [];
            }
          })()
        : [];
    return {
      id: row.id,
      status: row.status,
      mode: row.mode,
      pr_url: row.pr_url,
      message: row.message,
      job_id: row.job_id,
      repo_id: row.repo_id,
      module_id: row.module_id,
      from_version: row.from_version,
      to_version: row.to_version,
      created_at: row.created_at,
      updated_at: row.updated_at,
      approval_state: row.approval_state || 'none',
      approver: row.approver,
      approval_comment: row.approval_comment,
      approved_at: row.approved_at,
      analysis,
      chat_messages: chatMessages,
      recommendations: rec?.downtime_required !== undefined ? rec : analysis.recommendations || null,
      downtime_required: rec?.downtime_required ?? analysis.downtime_required ?? null,
      requires_restart: rec?.requires_restart ?? analysis.requires_restart ?? null,
      estimated_duration: rec?.estimated_duration ?? analysis.estimated_duration ?? null,
      upgrade_category: rec?.upgrade_category ?? analysis.upgrade_category ?? null,
      upgrade_paths: rec?.upgrade_paths ?? analysis.upgrade_paths ?? [],
      prerequisites: rec?.prerequisites ?? analysis.prerequisites ?? null,
      multi_az_plan: rec?.multi_az_plan ?? analysis.multi_az_plan ?? null,
      alternatives: rec?.alternatives ?? analysis.alternatives ?? [],
      doc_citations: rec?.doc_citations ?? analysis.doc_citations ?? [],
      docs_source: rec?.docs_source ?? analysis.docs_source ?? null,
    };
  }

  listApprovers(): { approvers: string[]; source: string } {
    const raw = process.env.GIT_APPROVERS || '';
    const approvers = raw
      .split(/[,;]/)
      .map((s) => s.trim())
      .filter(Boolean);
    return {
      approvers,
      source: approvers.length ? 'env' : 'open',
    };
  }

  private validateApprover(approver: string): { ok: boolean; message?: string } {
    const name = (approver || '').trim();
    if (!name) return { ok: false, message: 'approver is required' };
    const { approvers } = this.listApprovers();
    if (approvers.length && !approvers.includes(name)) {
      return {
        ok: false,
        message: `approver must be one of: ${approvers.join(', ')}`,
      };
    }
    return { ok: true };
  }

  async getPrRequest(id: string) {
    const res = await this.db.query(`SELECT * FROM pr_draft_requests WHERE id = $1`, [id]);
    if (!res.rows.length) return { error: 'not_found', message: `PR request ${id} not found` };
    return this.formatPrRequest(res.rows[0]);
  }

  private async gatherAnalysisContext(body: {
    repo_id: string;
    module_id: string;
    from_version: string;
    to_version: string;
  }) {
    const from = await this.loadContract(body.module_id, body.from_version);
    const to = await this.loadContract(body.module_id, body.to_version);
    const diff = from && to ? this.diffContracts(from, to) : null;

    const resourcesRes = await this.db.query(
      `SELECT address, type, name, attributes
       FROM resources
       WHERE repo_id = $1
         AND (
           type IN ('aws_db_instance','aws_rds_cluster','aws_rds_cluster_instance','aws_instance','aws_autoscaling_group','aws_launch_template','aws_eks_cluster')
           OR attributes ? 'engine_version'
           OR attributes ? 'multi_az'
           OR attributes ? 'ami'
         )
       ORDER BY type, name
       LIMIT 50`,
      [body.repo_id],
    );

    // Also pull module-source repo resources when consumer has few local signals
    let resources = resourcesRes.rows.map((r) => ({
      address: r.address,
      type: r.type,
      name: r.name,
      attributes: r.attributes || {},
    }));

    if (resources.length < 2) {
      const upstream = await this.db.query(
        `SELECT address, type, name, attributes
         FROM resources
         WHERE repo_id = $1
         ORDER BY type, name
         LIMIT 30`,
        [body.module_id],
      );
      resources = [
        ...resources,
        ...upstream.rows.map((r) => ({
          address: r.address,
          type: r.type,
          name: r.name,
          attributes: r.attributes || {},
          source_repo: body.module_id,
        })),
      ];
    }

    // Enrich from config_values when attributes missing MultiAZ / engine
    const cfg = await this.db.query(
      `SELECT key, value_json FROM config_values
       WHERE repo_id = $1 AND key ILIKE ANY(ARRAY['%multi_az%','%engine_version%','%instance_class%','%ami%'])
       LIMIT 40`,
      [body.repo_id],
    );

    return {
      module_id: body.module_id,
      repo_id: body.repo_id,
      from_version: body.from_version,
      to_version: body.to_version,
      diff_summary: diff?.summary || {},
      from_variables: from?.variables || [],
      to_variables: to?.variables || [],
      resources,
      config_hints: cfg.rows,
      consumer_severity: null as string | null,
    };
  }

  private async callAiAnalyze(context: Awaited<ReturnType<ReleaseCompareService['gatherAnalysisContext']>>) {
    const aiUrl = process.env.AI_SERVICE_URL || 'http://ai:8100';
    try {
      const res = await fetch(`${aiUrl}/release-compare/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(context),
        signal: AbortSignal.timeout(25000),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`AI HTTP ${res.status}: ${text.slice(0, 200)}`);
      }
      return await res.json();
    } catch (e: any) {
      // Graceful offline fallback — structured advice without live docs
      return {
        status: 'degraded',
        docs_source: 'error',
        recommendations: {
          downtime_required: true,
          requires_restart: true,
          estimated_duration: 'unknown — AI service unreachable; assume maintenance window',
          upgrade_category: 'Unknown (offline analysis)',
          upgrade_categories: ['Unknown (offline analysis)'],
          upgrade_paths: [
            {
              id: 'inplace',
              name: 'Path A: In-place upgrade',
              recommended: false,
              requires_restart: true,
              requires_downtime: true,
              summary: 'Offline fallback — prefer verifying Path A only after AI is reachable.',
              when_to_use: 'Minor changes when live analysis unavailable.',
              steps: ['Confirm SNAPSHOT', 'Confirm AMI if EC2', 'Schedule maintenance window'],
              prerequisites_gate: ['snapshot', 'ami'],
            },
            {
              id: 'new_instance_migrate',
              name: 'Path B: Build new instance and move data',
              recommended: true,
              requires_restart: true,
              requires_downtime: true,
              summary: 'Safer default while offline: blue/green or snapshot-restore then cut over.',
              when_to_use: 'Major upgrades or when in-place risk is unknown.',
              steps: ['Confirm SNAPSHOT', 'Confirm AMI', 'Build new', 'Cut over', 'Decommission old'],
              prerequisites_gate: ['snapshot', 'ami'],
              aliases: ['blue_green', 'replace'],
            },
          ],
          recommended_path_id: 'new_instance_migrate',
          prerequisites: {
            snapshot_required: true,
            snapshot_status: 'unknown',
            snapshot_evidence: 'not found in graph — engineer must confirm (AI offline)',
            ami_required: true,
            ami_status: 'unknown',
            ami_evidence: 'not found in graph — engineer must confirm (AI offline)',
            checklist: [
              {
                id: 'snapshot',
                key: 'snapshot_required',
                label: 'SNAPSHOT required before change',
                required: true,
                status: 'unknown',
                evidence: 'not found in graph — engineer must confirm (AI offline)',
              },
              {
                id: 'ami',
                key: 'ami_required',
                label: 'AMI / golden image verified',
                required: true,
                status: 'unknown',
                evidence: 'not found in graph — engineer must confirm (AI offline)',
              },
            ],
            blocking: ['snapshot', 'ami'],
          },
          multi_az_plan: {
            applicable: null,
            summary: 'Could not analyze Multi-AZ; if enabled, upgrade standby/secondary first then primary.',
            order: [
              'If Multi-AZ: secondary first, then primary (AWS-safe order).',
              'Prefer blue/green for major engine upgrades.',
            ],
          },
          alternatives: [
            {
              name: 'Blue/Green deployment',
              description: 'Create green environment, upgrade, cut over.',
            },
            {
              name: 'In-place with maintenance window',
              description: 'Schedule terraform apply during an approved window.',
            },
          ],
          doc_citations: [],
          docs_source: 'error',
          rationale: [`AI analyze failed: ${e?.message || e}`],
          summary: `Offline fallback for ${context.module_id} ${context.from_version}→${context.to_version}`,
        },
        downtime_required: true,
        requires_restart: true,
        estimated_duration: 'unknown — AI service unreachable; assume maintenance window',
        upgrade_category: 'Unknown (offline analysis)',
        upgrade_paths: [
          {
            id: 'new_instance_migrate',
            name: 'Path B: Build new instance and move data',
            recommended: true,
            requires_restart: true,
            requires_downtime: true,
          },
        ],
        prerequisites: {
          snapshot_required: true,
          snapshot_status: 'unknown',
          ami_required: true,
          ami_status: 'unknown',
        },
        multi_az_plan: {
          applicable: null,
          summary: 'Could not analyze Multi-AZ; if enabled, upgrade standby/secondary first then primary.',
        },
        alternatives: [
          { name: 'Blue/Green deployment', description: 'Create green environment, upgrade, cut over.' },
        ],
        doc_citations: [],
        error: e?.message || String(e),
      };
    }
  }

  private async enqueueRaise(row: {
    id: string;
    repo_id: string;
    module_id: string;
    from_version: string;
    to_version: string;
    payload: any;
  }) {
    const githubToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
    const mode = githubToken ? 'github' : 'scaffold';
    const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload || {};

    let status = 'queued';
    let message =
      'PR draft queued. Configure GITHUB_TOKEN and a GitHub App/PAT with contents+pull_requests to open real PRs.';
    let jobId: string | null = null;

    if (mode === 'scaffold') {
      status = 'awaiting_github_credentials';
      const job = await this.queue.enqueue({
        type: 'raise_pull_request',
        priority: 'P1',
        repo_id: row.repo_id,
        payload: { ...payload, mode: 'scaffold', pr_request_id: row.id },
      });
      jobId = job?.id || null;
      message =
        'Approved — scaffolded raise-PR enqueued. No GitHub credentials configured — status awaits GITHUB_TOKEN / GH_TOKEN.';
    } else {
      status = 'pending_implementation';
      message =
        'Approved — GITHUB_TOKEN detected but Octokit PR creation is not implemented yet. Request recorded for follow-up.';
      const job = await this.queue.enqueue({
        type: 'raise_pull_request',
        priority: 'P1',
        repo_id: row.repo_id,
        payload: { ...payload, mode: 'github_pending', pr_request_id: row.id },
      });
      jobId = job?.id || null;
    }

    const updated = await this.db.query(
      `UPDATE pr_draft_requests
       SET status = $2, mode = $3, message = $4, job_id = $5, updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [row.id, status, mode, message, jobId],
    );
    return updated.rows[0];
  }

  async approvePrRequest(id: string, body: { approver: string; comment?: string }) {
    const check = this.validateApprover(body?.approver);
    if (!check.ok) return { error: 'invalid_approver', message: check.message };

    const existing = await this.db.query(`SELECT * FROM pr_draft_requests WHERE id = $1`, [id]);
    if (!existing.rows.length) return { error: 'not_found', message: `PR request ${id} not found` };
    const row = existing.rows[0];
    if (row.approval_state === 'approved' && row.job_id) {
      return this.formatPrRequest(row);
    }
    if (row.approval_state === 'rejected') {
      return { error: 'already_rejected', message: 'Request was rejected; create a new Raise PR.' };
    }
    if (!['awaiting_approval', 'pending_analysis'].includes(row.status) && row.approval_state !== 'awaiting_approval') {
      if (row.approval_state === 'approved') return this.formatPrRequest(row);
    }

    await this.db.query(
      `UPDATE pr_draft_requests
       SET approval_state = 'approved',
           approver = $2,
           approval_comment = $3,
           approved_at = now(),
           status = 'approved',
           updated_at = now()
       WHERE id = $1`,
      [id, body.approver.trim(), body.comment || null],
    );

    await this.db.query(
      `INSERT INTO audit_log (actor, action, target) VALUES ($1, 'PR request approved', $2)`,
      [body.approver.trim(), id],
    );

    const refreshed = await this.db.query(`SELECT * FROM pr_draft_requests WHERE id = $1`, [id]);
    const queued = await this.enqueueRaise(refreshed.rows[0]);
    return this.formatPrRequest(queued);
  }

  async rejectPrRequest(id: string, body: { approver: string; comment?: string }) {
    const check = this.validateApprover(body?.approver);
    if (!check.ok) return { error: 'invalid_approver', message: check.message };

    const existing = await this.db.query(`SELECT * FROM pr_draft_requests WHERE id = $1`, [id]);
    if (!existing.rows.length) return { error: 'not_found', message: `PR request ${id} not found` };
    const row = existing.rows[0];
    if (row.approval_state === 'approved' && row.job_id) {
      return { error: 'already_queued', message: 'Request already approved and queued; cannot reject.' };
    }

    const updated = await this.db.query(
      `UPDATE pr_draft_requests
       SET approval_state = 'rejected',
           approver = $2,
           approval_comment = $3,
           approved_at = now(),
           status = 'rejected',
           message = $4,
           updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [
        id,
        body.approver.trim(),
        body.comment || null,
        `Rejected by ${body.approver.trim()}${body.comment ? `: ${body.comment}` : ''}`,
      ],
    );

    await this.db.query(
      `INSERT INTO audit_log (actor, action, target) VALUES ($1, 'PR request rejected', $2)`,
      [body.approver.trim(), id],
    );

    return this.formatPrRequest(updated.rows[0]);
  }

  async proceedPrRequest(id: string) {
    const existing = await this.db.query(`SELECT * FROM pr_draft_requests WHERE id = $1`, [id]);
    if (!existing.rows.length) return { error: 'not_found', message: `PR request ${id} not found` };
    const row = existing.rows[0];
    if (row.approval_state !== 'approved') {
      return {
        error: 'not_approved',
        message: 'Git approver approval required before proceeding to open/queue the PR.',
        approval_state: row.approval_state,
      };
    }
    if (row.job_id) return this.formatPrRequest(row);
    const queued = await this.enqueueRaise(row);
    return this.formatPrRequest(queued);
  }

  async listPrRequests(limit = 50) {
    const res = await this.db.query(
      `SELECT * FROM pr_draft_requests ORDER BY created_at DESC LIMIT $1`,
      [limit],
    );
    return res.rows.map((r) => this.formatPrRequest(r));
  }

  async chatPrRequest(id: string, body: { message: string; persist?: boolean }) {
    const message = (body?.message || '').trim();
    if (!message) {
      return { error: 'missing_params', message: 'message is required' };
    }

    const existing = await this.db.query(`SELECT * FROM pr_draft_requests WHERE id = $1`, [id]);
    if (!existing.rows.length) return { error: 'not_found', message: `PR request ${id} not found` };
    const row = existing.rows[0];

    let history: any[] = [];
    try {
      history = Array.isArray(row.chat_messages)
        ? row.chat_messages
        : typeof row.chat_messages === 'string'
          ? JSON.parse(row.chat_messages || '[]')
          : [];
    } catch {
      history = [];
    }

    const analysis = row.analysis || {};
    const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload || {};
    const aiUrl = process.env.AI_SERVICE_URL || 'http://ai:8100';

    let reply: any;
    let status = 'ok';
    try {
      const res = await fetch(`${aiUrl}/release-compare/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message,
          analysis,
          history: history.slice(-12),
          context: {
            module_id: row.module_id,
            repo_id: row.repo_id,
            from_version: row.from_version,
            to_version: row.to_version,
            diff_summary: analysis?.context?.diff_summary || payload,
            recommendations: analysis.recommendations || analysis,
            doc_citations: analysis.doc_citations || analysis.recommendations?.doc_citations || [],
            resource_signals: analysis.recommendations?.resource_signals || null,
          },
        }),
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`AI HTTP ${res.status}: ${text.slice(0, 200)}`);
      }
      const data = await res.json();
      reply = data.reply || {
        role: 'assistant',
        content: data.content || 'No reply',
        citations: data.citations || [],
      };
    } catch (e: any) {
      status = 'degraded';
      const rec = analysis.recommendations || analysis;
      const prereq = rec.prerequisites || {};
      reply = {
        role: 'assistant',
        content: [
          `AI chat unreachable (${e?.message || e}). Offline brief for this PR:`,
          `• ${row.repo_id} / ${row.module_id} ${row.from_version} → ${row.to_version}`,
          `• Restart: ${rec.requires_restart ?? 'unknown'}; downtime: ${rec.downtime_required ?? 'unknown'}`,
          `• Snapshot: required=${prereq.snapshot_required} status=${prereq.snapshot_status || 'unknown'}`,
          `• AMI: required=${prereq.ami_required} status=${prereq.ami_status || 'unknown'}`,
          `• Paths: ${(rec.upgrade_paths || []).map((p: any) => `${p.name}${p.recommended ? ' ★' : ''}`).join('; ') || 'n/a'}`,
          '',
          'Retry when the AI service is up for doc-cited answers.',
        ].join('\n'),
        citations: [],
        scoped: true,
        degraded: true,
      };
    }

    const userMsg = {
      role: 'user',
      content: message,
      at: new Date().toISOString(),
    };
    const assistantMsg = {
      role: 'assistant',
      content: reply.content,
      citations: reply.citations || [],
      at: new Date().toISOString(),
      degraded: status === 'degraded',
    };

    const persist = body.persist !== false;
    let chatMessages = [...history, userMsg, assistantMsg];
    if (chatMessages.length > 40) chatMessages = chatMessages.slice(-40);

    if (persist) {
      try {
        await this.db.query(
          `UPDATE pr_draft_requests
           SET chat_messages = $2::jsonb, updated_at = now()
           WHERE id = $1`,
          [id, JSON.stringify(chatMessages)],
        );
      } catch (err: any) {
        // Column may not exist yet on older volumes — try ALTER then retry once
        if (String(err?.message || '').includes('chat_messages')) {
          await this.db.query(
            `ALTER TABLE pr_draft_requests ADD COLUMN IF NOT EXISTS chat_messages JSONB NOT NULL DEFAULT '[]'`,
          );
          await this.db.query(
            `UPDATE pr_draft_requests
             SET chat_messages = $2::jsonb, updated_at = now()
             WHERE id = $1`,
            [id, JSON.stringify(chatMessages)],
          );
        } else {
          throw err;
        }
      }
    }

    return {
      status,
      id,
      reply: assistantMsg,
      chat_messages: chatMessages,
      request: this.formatPrRequest({ ...row, chat_messages: chatMessages }),
    };
  }
}
