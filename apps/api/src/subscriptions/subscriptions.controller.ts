import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { QueueService } from '../queue/queue.service';
import * as fs from 'fs';
import * as path from 'path';

function stackIdFromFile(file?: string | null): string | null {
  if (!file) return null;
  const normalized = file.replace(/\\/g, '/');
  const parts = normalized.split('/');
  if (parts.length >= 2) return parts[parts.length - 2];
  return path.basename(normalized, path.extname(normalized));
}

function configPath() {
  return path.join(process.env.PROJECT_ROOT || '/app', 'config', 'repo-subscriptions.json');
}

@Controller('subscriptions')
export class SubscriptionsController {
  constructor(private db: DbService, private queue: QueueService) {}

  @Get()
  async list() {
    const res = await this.db.query(
      `SELECT s.id, s.github_full_name, s.role, s.subscribed, s.entitlement_tier, s.scan_profile, s.local_path,
              s.appsvn, s.application_label,
              s.last_scan_at, s.last_scan_status, s.graph_node_count, s.triggers_enabled, s.module_sources_watched,
              (SELECT count(*)::int FROM resources r WHERE r.repo_id = s.id) AS resource_count
       FROM subscriptions s ORDER BY s.id`,
    );
    return res.rows.map((r) => ({
      id: r.id,
      name: r.github_full_name,
      role: r.role,
      subscribed: r.subscribed,
      tier: r.entitlement_tier,
      appsvn: r.appsvn || null,
      application_label: r.application_label || null,
      stacks: r.graph_node_count || 0,
      resource_count: r.resource_count || 0,
      lastScan: r.last_scan_at ? new Date(r.last_scan_at).toLocaleString() : '—',
      last_scan_status: r.last_scan_status,
      triggers: r.triggers_enabled,
      module_sources_watched: r.module_sources_watched,
      scan_profile: r.scan_profile,
      local_path: r.local_path,
    }));
  }

  @Patch(':repoId')
  async updateSubscription(
    @Param('repoId') repoId: string,
    @Body() body: { subscribed?: boolean; role?: string; entitlement_tier?: string },
  ) {
    const current = await this.db.query(`SELECT id, subscribed FROM subscriptions WHERE id=$1`, [repoId]);
    if (!current.rows.length) {
      return { error: 'not_found', repo_id: repoId };
    }

    const subscribed = body.subscribed ?? current.rows[0].subscribed;
    await this.db.query(
      `UPDATE subscriptions SET
         subscribed = $2,
         role = COALESCE($3, role),
         entitlement_tier = COALESCE($4, entitlement_tier),
         updated_at = now()
       WHERE id = $1`,
      [repoId, subscribed, body.role || null, body.entitlement_tier || null],
    );

    // Keep config file in sync so worker intake gate matches UI
    try {
      const cfgPath = configPath();
      const data = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      const repo = (data.repos || []).find((r: any) => r.id === repoId);
      if (repo) {
        repo.subscribed = subscribed;
        if (body.role) repo.role = body.role;
        if (body.entitlement_tier) repo.entitlement_tier = body.entitlement_tier;
        fs.writeFileSync(cfgPath, JSON.stringify(data, null, 2) + '\n');
      }
    } catch {
      // config may be read-only in some deploys; DB update still applies for API listing
    }

    let job = null;
    if (subscribed === true && body.subscribed === true) {
      job = await this.queue.enqueue({ type: 'full_scan', priority: 'P2', repo_id: repoId });
    }

    return { repo_id: repoId, subscribed, job, message: subscribed ? 'Subscribed' : 'Unsubscribed' };
  }

  @Post(':repoId/scan')
  async triggerScan(@Param('repoId') repoId: string) {
    const job = await this.queue.enqueue({
      type: 'full_scan',
      priority: 'P2',
      repo_id: repoId,
    });
    await this.db.query(
      `UPDATE subscriptions SET last_scan_status = 'queued', updated_at = now() WHERE id = $1`,
      [repoId],
    );
    return { message: 'Scan enqueued', job };
  }

  @Post('sync')
  async syncFromConfig() {
    const data = JSON.parse(fs.readFileSync(configPath(), 'utf8'));
    for (const r of data.repos) {
      await this.db.query(
        `INSERT INTO subscriptions (id, github_full_name, role, subscribed, entitlement_tier, scan_profile, local_path,
           appsvn, application_label, triggers_enabled, module_sources_watched, compliance_scope, contacts, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,now())
         ON CONFLICT (id) DO UPDATE SET
           github_full_name = EXCLUDED.github_full_name,
           role = EXCLUDED.role,
           subscribed = EXCLUDED.subscribed,
           entitlement_tier = EXCLUDED.entitlement_tier,
           scan_profile = EXCLUDED.scan_profile,
           local_path = EXCLUDED.local_path,
           appsvn = EXCLUDED.appsvn,
           application_label = EXCLUDED.application_label,
           triggers_enabled = EXCLUDED.triggers_enabled,
           module_sources_watched = EXCLUDED.module_sources_watched,
           compliance_scope = EXCLUDED.compliance_scope,
           contacts = EXCLUDED.contacts,
           updated_at = now()`,
        [
          r.id,
          r.github_full_name,
          r.role,
          r.subscribed,
          r.entitlement_tier || null,
          r.scan_profile || null,
          r.local_path || null,
          r.appsvn || null,
          r.application_label || null,
          JSON.stringify(r.triggers_enabled || {}),
          JSON.stringify(r.module_sources_watched || []),
          JSON.stringify(r.compliance_scope || []),
          JSON.stringify(r.contacts || {}),
        ],
      );
    }
    return { synced: data.repos.length, org_id: data.org_id || null };
  }

  @Get(':repoId/resources')
  async listResources(@Param('repoId') repoId: string) {
    const res = await this.db.query(
      `SELECT id, address, type, name, file, line, service_id, attributes, created_at
       FROM resources WHERE repo_id = $1 ORDER BY address`,
      [repoId],
    );
    return {
      repo_id: repoId,
      resources: res.rows.map((r) => ({
        id: r.address,
        type: r.type,
        name: r.name,
        provider: r.type?.startsWith('aws_') ? 'aws' : r.attributes?.provider || r.type?.split('_')[0],
        stack_id: stackIdFromFile(r.file),
        address: r.address,
        file: r.file,
        line: r.line,
        service_id: r.service_id,
        attributes: r.attributes,
      })),
    };
  }

  @Get(':repoId/upstream-layers')
  async listUpstreamLayers(@Param('repoId') repoId: string) {
    const res = await this.db.query(
      `SELECT depth AS layer,
              array_agg(DISTINCT module_id ORDER BY module_id) AS modules,
              array_agg(DISTINCT upstream_repo_id ORDER BY upstream_repo_id) AS upstream_repos
       FROM upstream_lineage
       WHERE consumer_repo_id = $1
       GROUP BY depth
       ORDER BY depth`,
      [repoId],
    );

    const layers = res.rows.map((r) => ({
      layer: Number(r.layer),
      modules: r.modules || [],
      upstream_repos: r.upstream_repos || [],
    }));
    const count = layers.reduce((max, l) => Math.max(max, l.layer), 0);

    return {
      repo_id: repoId,
      count: count || layers.length,
      layers,
    };
  }

  @Get(':repoId/dependencies')
  async listDependencies(@Param('repoId') repoId: string) {
    const [resourceDeps, stackDeps, moduleRefs] = await Promise.all([
      this.db.query(
        `SELECT from_address, to_address, kind FROM resource_dependencies WHERE repo_id = $1 ORDER BY from_address`,
        [repoId],
      ),
      this.db.query(
        `SELECT stack_file, depends_on_path FROM stack_dependencies WHERE repo_id = $1 ORDER BY stack_file`,
        [repoId],
      ),
      this.db.query(
        `SELECT stack_file, module_source, ref, version, file, line FROM module_references WHERE repo_id = $1 ORDER BY module_source`,
        [repoId],
      ),
    ]);
    return {
      repo_id: repoId,
      resource_dependencies: resourceDeps.rows,
      stack_dependencies: stackDeps.rows,
      module_references: moduleRefs.rows,
    };
  }

  @Get(':repoId/parsed-blocks')
  async listParsedBlocks(
    @Param('repoId') repoId: string,
    @Query('type') blockType?: string,
  ) {
    const params: string[] = [repoId];
    let sql = `SELECT id, block_type, labels, file, line, attributes, nested_blocks, created_at
               FROM parsed_blocks WHERE repo_id = $1`;
    if (blockType) {
      params.push(blockType);
      sql += ` AND block_type = $2`;
    }
    sql += ` ORDER BY file, line`;
    const res = await this.db.query(sql, params);
    return {
      repo_id: repoId,
      block_type: blockType || null,
      count: res.rows.length,
      blocks: res.rows,
    };
  }

  @Get(':repoId/variables')
  async listVariables(@Param('repoId') repoId: string) {
    const res = await this.db.query(
      `SELECT name, var_type, default_json, sensitive, description, file, line, created_at
       FROM variables WHERE repo_id = $1 ORDER BY name`,
      [repoId],
    );
    return {
      repo_id: repoId,
      count: res.rows.length,
      variables: res.rows.map((v) => ({
        name: v.name,
        var_type: v.var_type,
        default: v.default_json,
        sensitive: v.sensitive,
        description: v.description,
        file: v.file,
        line: v.line,
        created_at: v.created_at,
      })),
    };
  }
}
