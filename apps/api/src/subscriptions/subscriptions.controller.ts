import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { DbService } from '../db/db.service';
import { QueueService } from '../queue/queue.service';
import * as fs from 'fs';
import * as path from 'path';

const GITHUB_FULL_NAME_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const ROLES = new Set(['module_source', 'downstream_consumer']);
const DEFAULT_SCAN_PROFILE = 'enterprise-aws-default';
const DEFAULT_TRIGGERS = {
  release_tag_mandatory_analysis: true,
  pr_impact_comment: true,
  eol_alerts: true,
};

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

function slugFromGithubFullName(fullName: string): string {
  return fullName
    .trim()
    .toLowerCase()
    .replace(/\//g, '-')
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function normalizeGithubFullName(raw: string): string {
  return String(raw || '')
    .trim()
    .replace(/^https?:\/\/(www\.)?github\.com\//i, '')
    .replace(/\.git$/i, '')
    .replace(/\/+$/, '');
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
              s.last_scanned_sha, s.last_scanned_ref, s.last_incremental_at, s.last_full_scan_at, s.scan_stats,
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
      last_scanned_sha: r.last_scanned_sha || null,
      last_scanned_ref: r.last_scanned_ref || null,
      last_incremental_at: r.last_incremental_at || null,
      last_full_scan_at: r.last_full_scan_at || null,
      scan_stats: r.scan_stats || {},
      triggers: r.triggers_enabled,
      module_sources_watched: r.module_sources_watched,
      scan_profile: r.scan_profile,
      local_path: r.local_path,
    }));
  }

  @Post()
  @HttpCode(201)
  async createSubscription(
    @Body()
    body: {
      github_full_name?: string;
      id?: string;
      role?: string;
      entitlement_tier?: string;
      scan_profile?: string;
      subscribed?: boolean;
      appsvn?: string;
      application_label?: string;
      local_path?: string;
      triggers_enabled?: Record<string, boolean>;
    },
  ) {
    const githubFullName = normalizeGithubFullName(body.github_full_name || '');
    if (!githubFullName || !GITHUB_FULL_NAME_RE.test(githubFullName)) {
      throw new BadRequestException(
        'github_full_name is required and must look like org/repo',
      );
    }

    const role = body.role || 'downstream_consumer';
    if (!ROLES.has(role)) {
      throw new BadRequestException(
        'role must be module_source or downstream_consumer',
      );
    }

    const id = (body.id || '').trim() || slugFromGithubFullName(githubFullName);
    if (!id) {
      throw new BadRequestException('id could not be derived; provide an internal id');
    }

    const subscribed = body.subscribed !== false;
    const entitlementTier = (body.entitlement_tier || 'standard').trim() || 'standard';
    const scanProfile =
      (body.scan_profile || DEFAULT_SCAN_PROFILE).trim() || DEFAULT_SCAN_PROFILE;
    const appsvn = (body.appsvn || '').trim() || null;
    const applicationLabel = (body.application_label || '').trim() || null;
    const localPath = (body.local_path || '').trim() || null;
    const triggers = body.triggers_enabled || DEFAULT_TRIGGERS;

    await this.db.query(
      `INSERT INTO subscriptions (id, github_full_name, role, subscribed, entitlement_tier, scan_profile, local_path,
         appsvn, application_label, triggers_enabled, module_sources_watched, compliance_scope, contacts, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'[]'::jsonb,'[]'::jsonb,'{}'::jsonb,now())
       ON CONFLICT (id) DO UPDATE SET
         github_full_name = EXCLUDED.github_full_name,
         role = EXCLUDED.role,
         subscribed = EXCLUDED.subscribed,
         entitlement_tier = EXCLUDED.entitlement_tier,
         scan_profile = EXCLUDED.scan_profile,
         local_path = COALESCE(EXCLUDED.local_path, subscriptions.local_path),
         appsvn = COALESCE(EXCLUDED.appsvn, subscriptions.appsvn),
         application_label = COALESCE(EXCLUDED.application_label, subscriptions.application_label),
         triggers_enabled = EXCLUDED.triggers_enabled,
         updated_at = now()`,
      [
        id,
        githubFullName,
        role,
        subscribed,
        entitlementTier,
        scanProfile,
        localPath,
        appsvn,
        applicationLabel,
        JSON.stringify(triggers),
      ],
    );

    // Best-effort config file sync (may be read-only in Docker)
    try {
      const cfgPath = configPath();
      const data = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      if (!Array.isArray(data.repos)) data.repos = [];
      let repo = data.repos.find((r: any) => r.id === id);
      if (!repo) {
        repo = { id };
        data.repos.push(repo);
      }
      repo.github_full_name = githubFullName;
      repo.role = role;
      repo.subscribed = subscribed;
      repo.entitlement_tier = entitlementTier;
      repo.scan_profile = scanProfile;
      if (localPath) repo.local_path = localPath;
      if (appsvn) repo.appsvn = appsvn;
      if (applicationLabel) repo.application_label = applicationLabel;
      repo.triggers_enabled = triggers;
      if (!repo.subscribed_at && subscribed) {
        repo.subscribed_at = new Date().toISOString();
      }
      fs.writeFileSync(cfgPath, JSON.stringify(data, null, 2) + '\n');
    } catch {
      // config may be read-only; DB is source of truth for API listing
    }

    let job = null;
    if (subscribed) {
      job = await this.queue.enqueue({
        type: 'full_scan',
        priority: 'P1',
        repo_id: id,
        payload: { trigger: 'subscribe_ui' },
      });
      await this.db.query(
        `UPDATE subscriptions SET last_scan_status = 'queued', updated_at = now() WHERE id = $1`,
        [id],
      );
    }

    return {
      id,
      name: githubFullName,
      github_full_name: githubFullName,
      role,
      subscribed,
      tier: entitlementTier,
      entitlement_tier: entitlementTier,
      scan_profile: scanProfile,
      appsvn,
      application_label: applicationLabel,
      local_path: localPath,
      job,
      message: subscribed
        ? 'Subscription created · initial scan queued'
        : 'Subscription created (not subscribed)',
    };
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
    const sub = await this.db.query(`SELECT id, subscribed FROM subscriptions WHERE id=$1`, [repoId]);
    if (!sub.rows.length) {
      return { error: 'not_found', repo_id: repoId };
    }
    if (!sub.rows[0].subscribed) {
      return {
        error: 'not_subscribed',
        repo_id: repoId,
        message: 'Adhoc scan requires an active subscription',
      };
    }
    const job = await this.queue.enqueue({
      type: 'full_scan',
      priority: 'P1',
      repo_id: repoId,
      payload: { trigger: 'adhoc_ui' },
    });
    await this.db.query(
      `UPDATE subscriptions SET last_scan_status = 'queued', updated_at = now() WHERE id = $1`,
      [repoId],
    );
    return { message: 'Adhoc scan enqueued', job, trigger: 'adhoc_ui' };
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
