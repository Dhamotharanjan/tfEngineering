import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { GraphService } from '../graph/graph.service';
import { PatternService } from '../graph/pattern.service';
import { DbService } from '../db/db.service';

@Controller('graph')
export class GraphController {
  constructor(
    private graph: GraphService,
    private patterns: PatternService,
    private db: DbService,
  ) {}

  /**
   * Layer 1 — Org-wide technical / pattern graph (no APPSVN required).
   * Alias: GET /graph/patterns
   */
  @Get('org')
  async orgGraph(
    @Query('limit') limit?: string,
    @Query('include') include?: string,
    @Query('family') family?: string,
    @Query('patternId') patternId?: string,
  ) {
    return this.patternsGraph(limit, include, family, patternId);
  }

  /** Family inventory for Layer 1 selector. */
  @Get('patterns/families')
  async patternFamilies() {
    return this.patterns.listFamilies();
  }

  /** Pattern catalog with classification + coverage + stamp status. */
  @Get('patterns/catalog')
  async patternCatalog(
    @Query('family') family?: string,
    @Query('patternId') patternId?: string,
  ) {
    return this.patterns.listCatalog({
      family: family?.trim() || undefined,
      patternId: patternId?.trim() || undefined,
    });
  }

  @Get('patterns/:patternId/coverage')
  async patternCoverage(@Param('patternId') patternId: string) {
    const detail = await this.patterns.getPatternDetail(patternId);
    return {
      pattern_id: patternId,
      coverage: detail.coverage,
      stamp: detail.stamp,
      stamped: detail.stamped,
    };
  }

  @Get('patterns/:patternId/graph')
  async patternGraph(
    @Param('patternId') patternId: string,
    @Query('limit') limit?: string,
  ) {
    const max = Math.min(Math.max(parseInt(limit || '200', 10) || 200, 20), 500);
    return this.patterns.getPatternGraph(patternId, { limit: max });
  }

  /** Architect + auditor single-shot architecture (ingress/egress/ports/protocols). */
  @Get('patterns/:patternId/architecture')
  async patternArchitecture(@Param('patternId') patternId: string) {
    return this.patterns.getPatternArchitecture(patternId);
  }

  @Get('patterns/:patternId')
  async patternDetail(@Param('patternId') patternId: string) {
    return this.patterns.getPatternDetail(patternId);
  }

  @Post('patterns/:patternId/stamp')
  async stampPattern(
    @Param('patternId') patternId: string,
    @Body()
    body: { auditor?: string; comment?: string; compliance_framework?: string },
  ) {
    return this.patterns.stampPattern(patternId, body || {});
  }

  /** Layer 1 — Technical pattern inventory + org technical graph. */
  @Get('patterns')
  async patternsGraph(
    @Query('limit') limit?: string,
    @Query('include') include?: string,
    @Query('family') family?: string,
    @Query('patternId') patternId?: string,
  ) {
    const max = Math.min(Math.max(parseInt(limit || '200', 10) || 200, 20), 500);
    const includeResources = (include || 'resources').split(',').includes('resources');
    const fam = family?.trim() || undefined;
    const pat = patternId?.trim() || undefined;

    const subs = await this.db.query(
      `SELECT id, github_full_name, role, subscribed, graph_node_count, appsvn, application_label,
              (SELECT count(*)::int FROM resources r WHERE r.repo_id = s.id) AS resource_count
       FROM subscriptions s WHERE subscribed = true ORDER BY id`,
    );
    const repoIds = subs.rows.map((r) => r.id);

    let graph: { nodes: any[]; edges: any[] };
    let patternGraphMeta: Record<string, any> | null = null;
    if (pat) {
      const pg = await this.patterns.getPatternGraph(pat, { limit: max });
      graph = pg.graph;
      patternGraphMeta = {
        pattern_id: pg.pattern_id,
        family: pg.family,
        tier: pg.tier,
        instance_count: pg.instance_count,
        source: pg.source,
      };
    } else {
      graph = await this.graph.getOrgGraph(repoIds, { limit: max, includeResources });
    }

    const legacy = await this.graph.getPatternSummary(repoIds);
    const enriched = await this.patterns.enrichPatternsPayload(fam, pat);
    const store = await this.graph.getStoreStatus();

    return {
      layer: 1,
      layer_label: 'Patterns',
      description:
        'Technical resource-family patterns with simple/complex classification and auditor stamping. Stamping a pattern inherits compliance coverage to APPSVN apps on that pattern.',
      org_id: 'acme-bank',
      family: fam || null,
      pattern_id: pat || null,
      subscribed_repos: subs.rows.map((r) => ({
        id: r.id,
        name: r.github_full_name,
        role: r.role,
        appsvn: r.appsvn || null,
        application_label: r.application_label || null,
        graph_nodes: r.graph_node_count || 0,
        resource_count: r.resource_count || 0,
      })),
      patterns: {
        ...legacy,
        catalog: enriched.catalog,
        families: enriched.families,
      },
      catalog: enriched.catalog,
      families: enriched.families,
      pattern_graph: patternGraphMeta,
      graph,
      store_status: store,
      counts: {
        repositories: subs.rows.length,
        graph_nodes: graph.nodes?.length || 0,
        graph_edges: graph.edges?.length || 0,
        resource_types: legacy.resource_types?.length || 0,
        module_sources: legacy.module_sources?.length || 0,
        catalog_patterns: enriched.pattern_counts.patterns,
        catalog_observed: enriched.pattern_counts.observed,
        catalog_stamped: enriched.pattern_counts.stamped,
      },
    };
  }

  /** Layer 2 — List applications (APPSVN) for UI selectors. */
  @Get('apps')
  async listApps() {
    const res = await this.db.query(
      `SELECT appsvn,
              COALESCE(MAX(application_label), appsvn) AS application_label,
              count(*)::int AS repo_count,
              array_agg(id ORDER BY id) AS repo_ids,
              array_agg(github_full_name ORDER BY id) AS repo_names,
              COALESCE(SUM((SELECT count(*)::int FROM resources r WHERE r.repo_id = s.id)), 0)::int AS resource_count
       FROM subscriptions s
       WHERE appsvn IS NOT NULL AND appsvn <> '' AND subscribed = true
       GROUP BY appsvn
       ORDER BY appsvn`,
    );
    return {
      layer: 2,
      layer_label: 'By Application',
      org_id: 'acme-bank',
      apps: res.rows.map((r) => ({
        appsvn: r.appsvn,
        label: r.application_label || r.appsvn,
        repo_count: r.repo_count || 0,
        resource_count: r.resource_count || 0,
        repo_ids: r.repo_ids || [],
        repo_names: r.repo_names || [],
      })),
    };
  }

  /**
   * Layer 2 — Infra graph filtered to repos/stacks/resources tagged with APPSVN.
   * Query: ?appsvn=APPSVN-1001
   */
  @Get('application')
  async applicationGraph(
    @Query('appsvn') appsvn?: string,
    @Query('limit') limit?: string,
    @Query('include') include?: string,
  ) {
    const tag = (appsvn || '').trim();
    if (!tag) {
      throw new BadRequestException('Query parameter appsvn is required');
    }

    const max = Math.min(Math.max(parseInt(limit || '200', 10) || 200, 20), 500);
    const includeResources = (include || 'resources').split(',').includes('resources');

    const subs = await this.db.query(
      `SELECT id, github_full_name, role, subscribed, graph_node_count, appsvn, application_label,
              (SELECT count(*)::int FROM resources r WHERE r.repo_id = s.id) AS resource_count
       FROM subscriptions s
       WHERE subscribed = true AND appsvn = $1
       ORDER BY id`,
      [tag],
    );

    if (!subs.rows.length) {
      const store = await this.graph.getStoreStatus();
      return {
        layer: 2,
        layer_label: 'By Application',
        appsvn: tag,
        application_label: null,
        description: `No subscribed repos tagged with ${tag}`,
        repos: [],
        graph: { nodes: [], edges: [] },
        store_status: store,
        counts: { repositories: 0, graph_nodes: 0, graph_edges: 0 },
      };
    }

    const repoIds = subs.rows.map((r) => r.id);
    const graph = await this.graph.getApplicationGraph(tag, repoIds, {
      limit: max,
      includeResources,
    });
    const store = await this.graph.getStoreStatus();
    const label = subs.rows.find((r) => r.application_label)?.application_label || tag;

    return {
      layer: 2,
      layer_label: 'By Application',
      appsvn: tag,
      application_label: label,
      description: `Application-scoped infra graph for ${label} (${tag}) — repos/stacks/resources linked to this APPSVN.`,
      repos: subs.rows.map((r) => ({
        id: r.id,
        name: r.github_full_name,
        role: r.role,
        appsvn: r.appsvn,
        application_label: r.application_label,
        graph_nodes: r.graph_node_count || 0,
        resource_count: r.resource_count || 0,
      })),
      graph,
      store_status: store,
      counts: {
        repositories: subs.rows.length,
        graph_nodes: graph.nodes?.length || 0,
        graph_edges: graph.edges?.length || 0,
      },
    };
  }
}
