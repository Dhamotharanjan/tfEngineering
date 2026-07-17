import { BadRequestException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { GraphService } from './graph.service';
import {
  ClassifiedResource,
  PATTERN_TAXONOMY,
  RESOURCE_FAMILIES,
  ResourceFamily,
  classifyResources,
  taxonomyById,
} from './pattern-classifier';
import { ArchitecturePayload, composeArchitecture, LiveNetworkResource, Neo4jTopoEdge } from './pattern-architecture';

@Injectable()
export class PatternService implements OnModuleInit {
  constructor(
    private db: DbService,
    private graph: GraphService,
  ) {}

  async onModuleInit() {
    await this.ensureCatalogSeeded();
  }

  /** Upsert taxonomy into infra_patterns for volumes that predate schema seed. */
  async ensureCatalogSeeded() {
    for (const p of PATTERN_TAXONOMY) {
      await this.db.query(
        `INSERT INTO infra_patterns (
           pattern_id, family, display_name, tier, audit_statement,
           finops_notes, architect_summary, detection_rules, seeded
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,'{}'::jsonb,true)
         ON CONFLICT (pattern_id) DO UPDATE SET
           family = EXCLUDED.family,
           display_name = EXCLUDED.display_name,
           tier = EXCLUDED.tier,
           audit_statement = EXCLUDED.audit_statement,
           finops_notes = EXCLUDED.finops_notes,
           architect_summary = EXCLUDED.architect_summary,
           updated_at = now()`,
        [
          p.pattern_id,
          p.family,
          p.display_name,
          p.tier,
          p.audit_statement,
          p.finops_notes,
          p.architect_summary,
        ],
      );
    }
  }

  private async loadResources(): Promise<ClassifiedResource[]> {
    const res = await this.db.query(
      `SELECT r.id, r.repo_id, r.address, r.type, r.name,
              COALESCE(r.appsvn, s.appsvn) AS appsvn,
              r.attributes
       FROM resources r
       LEFT JOIN subscriptions s ON s.id = r.repo_id
       WHERE r.type IN (
         'aws_db_instance', 'aws_rds_cluster', 'aws_rds_cluster_instance', 'aws_instance'
       )
       ORDER BY r.repo_id, r.address`,
    );
    const rows = res.rows.map((row) => ({
      id: row.id,
      repo_id: row.repo_id,
      address: row.address,
      type: row.type,
      name: row.name,
      appsvn: row.appsvn || null,
      attributes: typeof row.attributes === 'string' ? JSON.parse(row.attributes) : row.attributes,
    }));
    return classifyResources(rows);
  }

  async listFamilies() {
    const classified = await this.loadResources();
    return {
      families: RESOURCE_FAMILIES.map((f) => {
        const items = classified.filter((c) => c.family === f.id);
        const patternIds = new Set(items.map((i) => i.pattern_id));
        return {
          ...f,
          resource_count: items.length,
          pattern_count: patternIds.size,
          simple_count: items.filter((i) => i.tier === 'simple').length,
          complex_count: items.filter((i) => i.tier === 'complex').length,
        };
      }),
      totals: {
        resources: classified.length,
        patterns_observed: new Set(classified.map((c) => c.pattern_id)).size,
      },
    };
  }

  private async activeStamps(): Promise<
    Map<string, { id: string; auditor: string; comment: string | null; compliance_framework: string | null; stamped_at: string }>
  > {
    const res = await this.db.query(
      `SELECT DISTINCT ON (pattern_id)
         id, pattern_id, auditor, comment, compliance_framework, stamped_at
       FROM pattern_stamps
       WHERE revoked_at IS NULL
       ORDER BY pattern_id, stamped_at DESC`,
    );
    const map = new Map<
      string,
      { id: string; auditor: string; comment: string | null; compliance_framework: string | null; stamped_at: string }
    >();
    for (const row of res.rows) {
      map.set(row.pattern_id, {
        id: row.id,
        auditor: row.auditor,
        comment: row.comment,
        compliance_framework: row.compliance_framework,
        stamped_at: row.stamped_at,
      });
    }
    return map;
  }

  /**
   * Resolve APPSVN coverage for resources matching a pattern.
   * Direct: resource/repo appsvn. Inherited: consumers of the module repo
   * that owns the pattern resources (module_references / watched sources).
   */
  async coverageForResources(items: ClassifiedResource[]) {
    if (!items.length) {
      return { apps: [] as any[], repos: [] as any[], app_count: 0, repo_count: 0 };
    }

    const repoIds = [...new Set(items.map((i) => i.repo_id))];
    const directAppsvn = new Set(items.map((i) => i.appsvn).filter(Boolean) as string[]);

    const consumers = await this.db.query(
      `SELECT DISTINCT s.id, s.github_full_name, s.appsvn, s.application_label, s.role
       FROM subscriptions s
       WHERE s.subscribed = true
         AND (
           s.id = ANY($1::text[])
           OR EXISTS (
             SELECT 1 FROM module_references mr
             WHERE mr.repo_id = s.id
               AND (
                 mr.module_source = ANY($1::text[])
                 OR EXISTS (
                   SELECT 1 FROM unnest($1::text[]) AS x(repo)
                   WHERE mr.module_source ILIKE '%' || x.repo || '%'
                 )
               )
           )
           OR (
             jsonb_typeof(COALESCE(s.module_sources_watched, '[]'::jsonb)) = 'array'
             AND EXISTS (
               SELECT 1
               FROM jsonb_array_elements_text(COALESCE(s.module_sources_watched, '[]'::jsonb)) AS w(val)
               WHERE w.val = ANY($1::text[])
             )
           )
         )`,
      [repoIds],
    );

    const appsMap = new Map<
      string,
      { appsvn: string; label: string; repo_ids: string[]; repo_names: string[]; inherited: boolean }
    >();

    for (const a of directAppsvn) {
      appsMap.set(a, {
        appsvn: a,
        label: a,
        repo_ids: [],
        repo_names: [],
        inherited: false,
      });
    }

    for (const row of consumers.rows) {
      if (row.appsvn) {
        if (!appsMap.has(row.appsvn)) {
          appsMap.set(row.appsvn, {
            appsvn: row.appsvn,
            label: row.application_label || row.appsvn,
            repo_ids: [],
            repo_names: [],
            inherited: !directAppsvn.has(row.appsvn),
          });
        }
        const entry = appsMap.get(row.appsvn)!;
        if (row.application_label) entry.label = row.application_label;
        if (!entry.repo_ids.includes(row.id)) {
          entry.repo_ids.push(row.id);
          entry.repo_names.push(row.github_full_name || row.id);
        }
      }
    }

    // Fill labels for direct-only appsvn
    if (appsMap.size) {
      const labels = await this.db.query(
        `SELECT appsvn, MAX(application_label) AS application_label
         FROM subscriptions WHERE appsvn = ANY($1::text[]) GROUP BY appsvn`,
        [[...appsMap.keys()]],
      );
      for (const row of labels.rows) {
        const e = appsMap.get(row.appsvn);
        if (e && row.application_label) e.label = row.application_label;
      }
    }

    const apps = [...appsMap.values()].sort((a, b) => a.appsvn.localeCompare(b.appsvn));
    const repos = consumers.rows.map((r) => ({
      id: r.id,
      name: r.github_full_name,
      role: r.role,
      appsvn: r.appsvn || null,
      application_label: r.application_label || null,
    }));

    return {
      apps,
      repos,
      app_count: apps.length,
      repo_count: repos.length,
    };
  }

  async listCatalog(opts: { family?: string; patternId?: string } = {}) {
    await this.ensureCatalogSeeded();
    const classified = await this.loadResources();
    const stamps = await this.activeStamps();

    let defs = PATTERN_TAXONOMY;
    if (opts.family) {
      defs = defs.filter((d) => d.family === opts.family);
    }
    if (opts.patternId) {
      defs = defs.filter((d) => d.pattern_id === opts.patternId);
    }

    const catalog = [];
    for (const def of defs) {
      const instances = classified.filter((c) => c.pattern_id === def.pattern_id);
      const coverage = await this.coverageForResources(instances);
      const stamp = stamps.get(def.pattern_id) || null;
      catalog.push({
        ...def,
        observed: instances.length > 0,
        instance_count: instances.length,
        resource_ids: instances.map((i) => i.resource_id),
        repo_ids: [...new Set(instances.map((i) => i.repo_id))],
        detection_signals: [...new Set(instances.flatMap((i) => i.signals))],
        covered_app_count: coverage.app_count,
        covered_repo_count: coverage.repo_count,
        covered_apps: coverage.apps,
        stamp,
        stamped: !!stamp,
      });
    }

    // Sort: observed first, then family, simple before complex
    catalog.sort((a, b) => {
      if (a.observed !== b.observed) return a.observed ? -1 : 1;
      if (a.family !== b.family) return a.family.localeCompare(b.family);
      if (a.tier !== b.tier) return a.tier === 'simple' ? -1 : 1;
      return a.pattern_id.localeCompare(b.pattern_id);
    });

    return {
      layer: 1,
      layer_label: 'Patterns',
      family: opts.family || null,
      families: RESOURCE_FAMILIES,
      catalog,
      counts: {
        patterns: catalog.length,
        observed: catalog.filter((c) => c.observed).length,
        stamped: catalog.filter((c) => c.stamped).length,
        instances: classified.filter((c) =>
          opts.family ? c.family === opts.family : opts.patternId ? c.pattern_id === opts.patternId : true,
        ).length,
      },
    };
  }

  async getPatternDetail(patternId: string) {
    const def = taxonomyById(patternId);
    if (!def) throw new NotFoundException(`Unknown pattern ${patternId}`);

    const catalog = await this.listCatalog({ patternId });
    const entry = catalog.catalog[0];
    const classified = (await this.loadResources()).filter((c) => c.pattern_id === patternId);
    const coverage = await this.coverageForResources(classified);

    const stampHistory = await this.db.query(
      `SELECT id, auditor, comment, compliance_framework, stamped_at, revoked_at
       FROM pattern_stamps WHERE pattern_id = $1
       ORDER BY stamped_at DESC LIMIT 20`,
      [patternId],
    );

    return {
      ...entry,
      instances: classified.map((c) => ({
        resource_id: c.resource_id,
        repo_id: c.repo_id,
        address: c.address,
        type: c.type,
        name: c.name,
        appsvn: c.appsvn,
        tier: c.tier,
        signals: c.signals,
        multi_az: c.attributes?.multi_az ?? null,
        engine: c.attributes?.engine ?? null,
        availability_zone: c.attributes?.availability_zone ?? null,
        tags: c.attributes?.tags ?? null,
      })),
      coverage,
      stamp_history: stampHistory.rows,
    };
  }

  async stampPattern(
    patternId: string,
    body: { auditor?: string; comment?: string; compliance_framework?: string },
  ) {
    const def = taxonomyById(patternId);
    if (!def) throw new NotFoundException(`Unknown pattern ${patternId}`);
    const auditor = (body.auditor || '').trim();
    if (!auditor) throw new BadRequestException('auditor is required');

    await this.ensureCatalogSeeded();

    // Revoke any prior active stamp so the latest is authoritative
    await this.db.query(
      `UPDATE pattern_stamps SET revoked_at = now()
       WHERE pattern_id = $1 AND revoked_at IS NULL`,
      [patternId],
    );

    const ins = await this.db.query(
      `INSERT INTO pattern_stamps (pattern_id, auditor, comment, compliance_framework, details)
       VALUES ($1,$2,$3,$4,$5::jsonb)
       RETURNING id, pattern_id, auditor, comment, compliance_framework, stamped_at`,
      [
        patternId,
        auditor,
        body.comment || null,
        body.compliance_framework || null,
        JSON.stringify({ family: def.family, tier: def.tier, display_name: def.display_name }),
      ],
    );

    await this.db.query(
      `INSERT INTO audit_log (actor, action, target, details)
       VALUES ($1, 'pattern_stamp', $2, $3::jsonb)`,
      [
        auditor,
        patternId,
        JSON.stringify({
          compliance_framework: body.compliance_framework || null,
          comment: body.comment || null,
        }),
      ],
    );

    const detail = await this.getPatternDetail(patternId);
    return {
      status: 'stamped',
      stamp: ins.rows[0],
      pattern: detail,
      inherited_coverage: detail.coverage,
      message: `Pattern ${patternId} stamped by ${auditor}. Coverage inherits to ${detail.coverage.app_count} APPSVN application(s).`,
    };
  }

  async getPatternGraph(patternId: string, opts: { limit?: number } = {}) {
    const def = taxonomyById(patternId);
    if (!def) throw new NotFoundException(`Unknown pattern ${patternId}`);

    const classified = (await this.loadResources()).filter((c) => c.pattern_id === patternId);
    const repoIds = [...new Set(classified.map((c) => c.repo_id))];
    const resourceIds = new Set(classified.map((c) => c.resource_id));
    const addresses = new Set(classified.map((c) => c.address));

    const base = await this.graph.getOrgGraph(repoIds, {
      limit: opts.limit ?? 200,
      includeResources: true,
    });

    const keepNodes = new Set<string>();
    for (const n of base.nodes || []) {
      if (n.type === 'repository' && repoIds.includes(n.id)) {
        keepNodes.add(n.id);
        continue;
      }
      if (resourceIds.has(n.id)) {
        keepNodes.add(n.id);
        continue;
      }
      // Neo4j cloud resource ids often match postgres resource ids
      if (n.type === 'cloudresource') {
        const detail = String(n.detail || '');
        const label = String(n.label || '');
        if (
          [...addresses].some((a) => n.id.includes(a) || detail.includes(a) || label.includes(a.split('.').pop() || ''))
        ) {
          keepNodes.add(n.id);
        }
        // Match by resource type family
        if (
          (def.family.startsWith('RDS') && /db_instance|rds_cluster|rds/i.test(detail + n.id)) ||
          (def.family === 'Ec2Oracle' && /oracle|aws_instance/i.test(detail + label + n.id))
        ) {
          // Only keep if linked to a matching classified address name
          const nameHit = classified.some(
            (c) => n.id.includes(c.name) || label.includes(c.name) || String(n.id).endsWith(c.address),
          );
          if (nameHit) keepNodes.add(n.id);
        }
      }
    }

    // Expand one hop from kept resources to related SG/subnet/VPC for topology context
    for (const e of base.edges || []) {
      if (keepNodes.has(e.from) && !keepNodes.has(e.to)) {
        const toNode = (base.nodes || []).find((n) => n.id === e.to);
        if (toNode && ['cloudresource', 'cidrblock', 'datasource'].includes(toNode.type)) {
          keepNodes.add(e.to);
        }
      }
      if (keepNodes.has(e.to) && !keepNodes.has(e.from)) {
        const fromNode = (base.nodes || []).find((n) => n.id === e.from);
        if (fromNode && fromNode.type === 'repository') keepNodes.add(e.from);
      }
    }

    const nodes = (base.nodes || []).filter((n) => keepNodes.has(n.id));
    const edges = (base.edges || []).filter((e) => keepNodes.has(e.from) && keepNodes.has(e.to));

    // Fallback synthetic graph from postgres when Neo4j filter is empty
    if (!nodes.length && classified.length) {
      const synthNodes: any[] = [];
      const synthEdges: any[] = [];
      const seen = new Set<string>();
      const add = (id: string, label: string, type: string, detail?: string) => {
        if (seen.has(id)) return;
        seen.add(id);
        const idx = synthNodes.length;
        synthNodes.push({
          id,
          label: String(label).slice(0, 48),
          type,
          detail: detail || label,
          x: 80 + (idx % 8) * 90,
          y: 60 + Math.floor(idx / 8) * 80,
        });
      };
      for (const c of classified) {
        add(c.repo_id, c.repo_id, 'repository');
        add(c.resource_id, c.name, 'cloudresource', c.type);
        synthEdges.push({ from: c.repo_id, to: c.resource_id, type: 'DEPLOYS' });
      }
      return {
        pattern_id: patternId,
        family: def.family,
        tier: def.tier,
        graph: { nodes: synthNodes, edges: synthEdges },
        instance_count: classified.length,
        source: 'postgres_fallback',
      };
    }

    return {
      pattern_id: patternId,
      family: def.family,
      tier: def.tier,
      graph: { nodes, edges },
      instance_count: classified.length,
      source: 'neo4j',
    };
  }

  async enrichPatternsPayload(family?: string, patternId?: string) {
    const catalog = await this.listCatalog({ family, patternId });
    const families = await this.listFamilies();
    return { catalog: catalog.catalog, families: families.families, pattern_counts: catalog.counts };
  }

  /**
   * Single-shot architect + auditor architecture view for a Layer-1 pattern:
   * AWS-role nodes, ingress/egress with port/protocol, topology facts, seed fill.
   */
  async getPatternArchitecture(patternId: string): Promise<ArchitecturePayload> {
    const def = taxonomyById(patternId);
    if (!def) throw new NotFoundException(`Unknown pattern ${patternId}`);

    const classified = (await this.loadResources()).filter((c) => c.pattern_id === patternId);
    const coverage = await this.coverageForResources(classified);
    const stamps = await this.activeStamps();
    const stamp = stamps.get(patternId) || null;

    const repoIds = [...new Set(classified.map((c) => c.repo_id))];
    // Include network module repos so VPC/SG/NAT from foundation scans are available
    const networkHintRepos = await this.db.query(
      `SELECT id FROM subscriptions
       WHERE subscribed = true
         AND (
           id = ANY($1::text[])
           OR id ILIKE '%network%'
           OR github_full_name ILIKE '%network%'
         )`,
      [repoIds.length ? repoIds : ['__none__']],
    );
    const scanRepos = [...new Set([...repoIds, ...networkHintRepos.rows.map((r) => r.id)])];

    const netRes = await this.db.query(
      `SELECT id, repo_id, address, type, name, attributes
       FROM resources
       WHERE type IN (
         'aws_vpc', 'aws_subnet', 'aws_security_group', 'aws_security_group_rule',
         'aws_internet_gateway', 'aws_nat_gateway', 'aws_route_table',
         'aws_route_table_association', 'aws_kms_key', 'aws_db_subnet_group'
       )
       AND (repo_id = ANY($1::text[]) OR cardinality($1::text[]) = 0)
       ORDER BY type, name
       LIMIT 200`,
      [scanRepos.length ? scanRepos : ['__none__']],
    );

    const networkResources: LiveNetworkResource[] = netRes.rows.map((row) => ({
      id: row.id,
      repo_id: row.repo_id,
      address: row.address,
      type: row.type,
      name: row.name,
      attributes: typeof row.attributes === 'string' ? JSON.parse(row.attributes) : row.attributes || {},
    }));

    let neo4jEdges: Neo4jTopoEdge[] = [];
    try {
      const pg = await this.getPatternGraph(patternId, { limit: 250 });
      const instanceIds = new Set(classified.map((c) => c.resource_id));
      const instanceNames = new Set(classified.map((c) => c.name.toLowerCase()));
      const networkTypes = /aws_vpc|aws_subnet|aws_security_group|aws_internet_gateway|aws_nat_gateway|aws_route_table|cidr/i;

      const isRelevantNode = (n: any) => {
        if (!n) return false;
        if (instanceIds.has(n.id)) return true;
        const detail = String(n.detail || n.label || n.id || '');
        if (networkTypes.test(detail) || n.type === 'cidrblock') return true;
        const label = String(n.label || '').toLowerCase();
        if ([...instanceNames].some((nm) => label.includes(nm) || String(n.id).includes(nm))) return true;
        return false;
      };

      const relevantIds = new Set<string>();
      for (const n of pg.graph?.nodes || []) {
        if (isRelevantNode(n)) relevantIds.add(n.id);
      }
      // one-hop expansion for SG/CIDR attachments from relevant nodes
      for (const e of pg.graph?.edges || []) {
        if (relevantIds.has(e.from) || relevantIds.has(e.to)) {
          const other = relevantIds.has(e.from) ? e.to : e.from;
          const otherNode = (pg.graph.nodes || []).find((n) => n.id === other);
          if (otherNode && (networkTypes.test(String(otherNode.detail || otherNode.id)) || otherNode.type === 'cidrblock')) {
            relevantIds.add(other);
          }
        }
      }

      for (const e of pg.graph?.edges || []) {
        if (!relevantIds.has(e.from) || !relevantIds.has(e.to)) continue;
        const fromNode = (pg.graph.nodes || []).find((n) => n.id === e.from);
        const toNode = (pg.graph.nodes || []).find((n) => n.id === e.to);
        neo4jEdges.push({
          from: e.from,
          to: e.to,
          type: e.type || 'RELATES_TO',
          fromLabel: fromNode?.label,
          toLabel: toNode?.label,
          fromDetail: fromNode?.detail,
          toDetail: toNode?.detail,
          toKind: toNode?.type,
        });
      }
    } catch {
      neo4jEdges = [];
    }

    return composeArchitecture({
      def,
      instances: classified,
      networkResources,
      neo4jEdges,
      coveredApps: coverage.apps,
      stamp,
    });
  }
}
