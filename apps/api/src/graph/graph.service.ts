import { Injectable } from '@nestjs/common';
import neo4j from 'neo4j-driver';
import { DbService } from '../db/db.service';

export type GraphSlice = 'repo' | 'component' | 'manifest' | 'lineage';

export type StoreStatus = { neo4j: 'ok' | 'error'; postgres: 'ok' | 'error' };

@Injectable()
export class GraphService {
  private driver: any;

  constructor(private db: DbService) {
    const uri = process.env.NEO4J_URI || 'bolt://localhost:7687';
    const user = process.env.NEO4J_USER || 'neo4j';
    const pass = process.env.NEO4J_PASSWORD || 'neo4j123';
    this.driver = neo4j.driver(uri, neo4j.auth.basic(user, pass));
  }

  private toNum(v: any): number {
    return v?.toNumber?.() ?? Number(v) ?? 0;
  }

  async getStoreStatus(): Promise<StoreStatus> {
    const status: StoreStatus = { neo4j: 'error', postgres: 'error' };
    try {
      const session = this.driver.session();
      try {
        await session.run('RETURN 1 AS ok');
        status.neo4j = 'ok';
      } finally {
        await session.close();
      }
    } catch {
      status.neo4j = 'error';
    }
    try {
      await this.db.query('SELECT 1');
      status.postgres = 'ok';
    } catch {
      status.postgres = 'error';
    }
    return status;
  }

  async getCounts(moduleId?: string, repoId?: string) {
    const session = this.driver.session();
    try {
      const modFilter = moduleId ? 'WHERE m.id = $moduleId OR m.id STARTS WITH $moduleId' : '';
      const params: Record<string, any> = {};
      if (moduleId) params.moduleId = moduleId;
      if (repoId) params.repoId = repoId;

      const repos = await session.run(
        repoId
          ? `MATCH (r:Repository {id: $repoId}) RETURN count(r) AS c`
          : moduleId
            ? `MATCH (m:Module)<-[:CONTAINS_MODULE|REFERENCES_MODULE|USES_MODULE]-(r:Repository) ${modFilter} RETURN count(DISTINCT r) AS c`
            : `MATCH (r:Repository) RETURN count(r) AS c`,
        params,
      );

      const resources = await session.run(
        moduleId
          ? repoId
            ? `MATCH (r:Repository {id: $repoId})-[:DEPLOYS]->(cr:CloudResource) RETURN count(DISTINCT cr) AS c`
            : `MATCH (m:Module)<-[:REFERENCES_MODULE|USES_MODULE]-(:Stack)<-[:HAS_STACK]-(r:Repository)-[:DEPLOYS]->(cr:CloudResource) ${modFilter} RETURN count(DISTINCT cr) AS c`
          : repoId
            ? `MATCH (r:Repository {id: $repoId})-[:DEPLOYS]->(cr:CloudResource) RETURN count(cr) AS c`
            : `MATCH (cr:CloudResource) RETURN count(cr) AS c`,
        params,
      );

      const modules = await session.run(
        moduleId ? `MATCH (m:Module) ${modFilter} RETURN count(m) AS c` : `MATCH (m:Module) RETURN count(m) AS c`,
        params,
      );

      const stacks = await session.run(
        moduleId
          ? repoId
            ? `MATCH (r:Repository {id: $repoId})-[:HAS_STACK]->(s:Stack) RETURN count(s) AS c`
            : `MATCH (m:Module)<-[:REFERENCES_MODULE|USES_MODULE]-(s:Stack) ${modFilter} RETURN count(DISTINCT s) AS c`
          : repoId
            ? `MATCH (r:Repository {id: $repoId})-[:HAS_STACK]->(s:Stack) RETURN count(s) AS c`
            : `MATCH (s:Stack) RETURN count(s) AS c`,
        params,
      );

      return {
        repositories: this.toNum(repos.records[0]?.get('c')),
        cloud_resources: this.toNum(resources.records[0]?.get('c')),
        modules: this.toNum(modules.records[0]?.get('c')),
        stacks: this.toNum(stacks.records[0]?.get('c')),
      };
    } finally {
      await session.close();
    }
  }

  async getSummary(moduleId?: string) {
    const counts = await this.getCounts(moduleId);
    const store_status = await this.getStoreStatus();
    return {
      module_id: moduleId || null,
      counts,
      store_status,
    };
  }

  async getBlastRadiusGraph(
    moduleId: string,
    opts: { slice?: GraphSlice; repoId?: string; depth?: number } = {},
  ) {
    const slice = opts.slice || 'component';
    const depth = Math.min(Math.max(opts.depth ?? 3, 1), 10);
    const store_status = await this.getStoreStatus();
    const session = this.driver.session();
    try {
      const nodes: any[] = [];
      const edges: any[] = [];
      const nodeSeen = new Set<string>();

      const addNode = (id: string, label: string, type: string, detail?: string) => {
        if (!id || nodeSeen.has(id)) return;
        nodeSeen.add(id);
        const idx = nodes.length;
        nodes.push({
          id,
          label: String(label || detail || id).slice(0, 48),
          type: type.toLowerCase(),
          detail: detail || label,
          x: 100 + (idx % 8) * 90,
          y: 80 + Math.floor(idx / 8) * 70,
        });
      };

      const addEdge = (from: string, to: string, type: string) => {
        if (!from || !to || from === to) return;
        const key = `${from}|${to}|${type}`;
        if (edges.some((e) => `${e.from}|${e.to}|${e.type}` === key)) return;
        edges.push({ from, to, type });
      };

      if (!moduleId) {
        const res = await session.run(`
          MATCH (n) WHERE n:Repository OR n:Module OR n:Stack OR n:CloudResource OR n:SecurityFinding
          RETURN coalesce(n.id, n.name, n.type) AS id, labels(n)[0] AS label,
                 coalesce(n.type, n.role, n.source, n.name, n.severity) AS detail
          LIMIT 80
        `);
        for (const rec of res.records) {
          addNode(rec.get('id'), rec.get('detail'), String(rec.get('label')).toLowerCase());
        }
        const edgeRes = await session.run(`
          MATCH (a)-[e]->(b)
          WHERE (a:Repository OR a:Module OR a:Stack OR a:CloudResource OR a:SecurityFinding)
            AND (b:Repository OR b:Module OR b:Stack OR b:CloudResource OR b:SecurityFinding)
          RETURN coalesce(a.id, a.name, a.type) AS fromId,
                 coalesce(b.id, b.name, b.type) AS toId, type(e) AS rel
          LIMIT 120
        `);
        for (const rec of edgeRes.records) {
          addEdge(rec.get('fromId'), rec.get('toId'), rec.get('rel'));
        }
        return { nodes, edges, slice, module_id: null, store_status };
      }

      const params: Record<string, any> = { moduleId, depth };
      if (opts.repoId) params.repoId = opts.repoId;

      if (slice === 'repo') {
        await this.buildRepoSlice(session, params, depth, opts.repoId, moduleId, addNode, addEdge);
      } else if (slice === 'manifest') {
        await this.buildManifestSlice(session, params, depth, opts.repoId, moduleId, addNode, addEdge);
      } else if (slice === 'lineage') {
        await this.buildLineageSlice(session, params, opts.repoId, moduleId, addNode, addEdge);
      } else {
        await this.buildComponentSlice(session, params, depth, opts.repoId, moduleId, addNode, addEdge);
      }

      return {
        nodes,
        edges,
        slice,
        module_id: moduleId,
        repo_id: opts.repoId || null,
        depth,
        store_status,
      };
    } finally {
      await session.close();
    }
  }

  private async buildRepoSlice(
    session: any,
    params: Record<string, any>,
    depth: number,
    repoId: string | undefined,
    moduleId: string,
    addNode: (id: string, label: string, type: string, detail?: string) => void,
    addEdge: (from: string, to: string, type: string) => void,
  ) {
    const repoFilter = repoId
      ? `AND (r.id = $repoId OR s.id STARTS WITH $repoId + ":")`
      : '';

    const res = await session.run(
      `
      MATCH (m:Module)
      WHERE m.id = $moduleId OR m.id STARTS WITH $moduleId
      WITH m
      OPTIONAL MATCH (m)-[:PROVIDED_BY]->(upstream:Repository)
      OPTIONAL MATCH (upstreamRepo:Repository)-[:CONTAINS_MODULE]->(m)
      OPTIONAL MATCH (downstream:Repository)-[:CONTAINS_MODULE]->(m)
      OPTIONAL MATCH (stack:Stack)-[:REFERENCES_MODULE|USES_MODULE]->(m)
      OPTIONAL MATCH (stackRepo:Repository)-[:HAS_STACK]->(stack)
      WITH m,
           collect(DISTINCT upstream) + collect(DISTINCT upstreamRepo) +
           collect(DISTINCT downstream) + collect(DISTINCT stackRepo) AS repos,
           collect(DISTINCT stack) AS stacks
      UNWIND repos AS r
      WITH m, r, stacks
      WHERE r IS NOT NULL ${repoFilter.replace(/s\.id/g, 'r.id')}
      OPTIONAL MATCH path = (r)-[:HAS_STACK|CONTAINS_MODULE|REFERENCES_MODULE|USES_MODULE|PROVIDED_BY*1..${depth}]-(n)
      WHERE n:Repository OR n:Module
      WITH m, r, collect(DISTINCT n) AS related
      UNWIND related AS node
      WITH m, r, node
      WHERE node IS NOT NULL
      RETURN
        coalesce(r.id, r.name) AS repoId,
        coalesce(r.role, r.github_full_name, r.id) AS repoLabel,
        coalesce(node.id, node.name) AS nodeId,
        labels(node)[0] AS nodeLabel,
        coalesce(node.role, node.github_full_name, node.source, node.id) AS nodeDetail,
        'RELATED' AS relType
      `,
      params,
    );

    addNode(moduleId, moduleId.split('@')[0].split('/').pop() || moduleId, 'module', moduleId);

    for (const rec of res.records) {
      const rid = rec.get('repoId');
      const nid = rec.get('nodeId');
      addNode(rid, rec.get('repoLabel'), 'repository');
      if (nid && nid !== rid) {
        addNode(nid, rec.get('nodeDetail'), String(rec.get('nodeLabel')).toLowerCase());
        addEdge(rid, nid, rec.get('relType'));
      }
    }

    const edgeRes = await session.run(
      `
      MATCH (m:Module)
      WHERE m.id = $moduleId OR m.id STARTS WITH $moduleId
      MATCH (consumer)-[ref:REFERENCES_MODULE|USES_MODULE|CONTAINS_MODULE]->(m)
      WHERE consumer:Repository OR consumer:Stack
      ${repoId ? 'AND ((consumer:Repository AND consumer.id = $repoId) OR (consumer:Stack AND consumer.id STARTS WITH $repoId + ":"))' : ''}
      RETURN
        coalesce(consumer.id, consumer.name) AS fromId,
        coalesce(m.id, m.source) AS toId,
        type(ref) AS relType,
        labels(consumer)[0] AS fromLabel,
        coalesce(consumer.role, consumer.file, consumer.id) AS fromDetail
      UNION
      MATCH (m:Module)
      WHERE m.id = $moduleId OR m.id STARTS WITH $moduleId
      MATCH (m)-[:PROVIDED_BY]->(upstream:Repository)
      RETURN
        coalesce(m.id, m.source) AS fromId,
        coalesce(upstream.id, upstream.name) AS toId,
        'PROVIDED_BY' AS relType,
        'Module' AS fromLabel,
        coalesce(m.source, m.id) AS fromDetail
      `,
      params,
    );

    for (const rec of edgeRes.records) {
      const fromId = rec.get('fromId');
      const toId = rec.get('toId');
      addNode(fromId, rec.get('fromDetail'), String(rec.get('fromLabel')).toLowerCase());
      addNode(toId, toId, fromId === moduleId ? 'module' : 'repository');
      addEdge(fromId, toId, rec.get('relType'));
    }
  }

  private async buildManifestSlice(
    session: any,
    params: Record<string, any>,
    depth: number,
    repoId: string | undefined,
    moduleId: string,
    addNode: (id: string, label: string, type: string, detail?: string) => void,
    addEdge: (from: string, to: string, type: string) => void,
  ) {
    const res = await session.run(
      `
      MATCH (m:Module)
      WHERE m.id = $moduleId OR m.id STARTS WITH $moduleId
      MATCH (consumer)-[ref:REFERENCES_MODULE|USES_MODULE]->(m)
      WHERE consumer:Stack OR consumer:Repository
      ${repoId ? 'AND ((consumer:Repository AND consumer.id = $repoId) OR (consumer:Stack AND consumer.id STARTS WITH $repoId + ":"))' : ''}
      RETURN
        coalesce(m.id, m.source) AS moduleId,
        coalesce(m.source, m.id) AS moduleSource,
        coalesce(ref.ref, ref.version, m.ref, m.version, 'latest') AS refVersion,
        coalesce(consumer.id, consumer.name) AS consumerId,
        labels(consumer)[0] AS consumerLabel,
        coalesce(consumer.file, consumer.role, consumer.id) AS consumerDetail,
        type(ref) AS relType
      ORDER BY refVersion, consumerId
      `,
      params,
    );

    addNode(moduleId, moduleId.split('@')[0].split('/').pop() || moduleId, 'module', moduleId);

    const versionGroups = new Map<string, string[]>();
    for (const rec of res.records) {
      const refVersion = String(rec.get('refVersion') || 'latest');
      const versionId = `${moduleId}@${refVersion}`;
      const consumerId = rec.get('consumerId');
      if (!versionGroups.has(versionId)) versionGroups.set(versionId, []);
      versionGroups.get(versionId)!.push(consumerId);
      addNode(consumerId, rec.get('consumerDetail'), String(rec.get('consumerLabel')).toLowerCase());
      addNode(versionId, refVersion, 'manifest', refVersion);
      addEdge(consumerId, versionId, rec.get('relType'));
      addEdge(versionId, moduleId, 'REFERENCES_MODULE');
    }

    for (const [versionId, consumers] of versionGroups) {
      if (consumers.length > 1) {
        addNode(`${versionId}:group`, `${consumers.length} consumers`, 'manifestgroup');
        addEdge(`${versionId}:group`, versionId, 'GROUPS');
      }
    }
  }

  /**
   * Upstream ↔ focus ↔ downstream repos, plus each repo's CloudResources.
   * Driven primarily by repoId (tree click); moduleId is a soft hint.
   */
  private async buildLineageSlice(
    session: any,
    params: Record<string, any>,
    repoId: string | undefined,
    moduleId: string,
    addNode: (id: string, label: string, type: string, detail?: string) => void,
    addEdge: (from: string, to: string, type: string) => void,
  ) {
    const focusId = repoId || null;
    const qParams = { ...params, focusId, moduleId };

    // Focus repo + its resources
    const focusRes = await session.run(
      `
      MATCH (focus:Repository)
      WHERE ($focusId IS NOT NULL AND focus.id = $focusId)
         OR ($focusId IS NULL AND (
              EXISTS {
                MATCH (focus)-[:HAS_STACK|CONTAINS_MODULE]->()-[:REFERENCES_MODULE|USES_MODULE|CONTAINS_MODULE]->(m:Module)
                WHERE m.id = $moduleId OR m.id STARTS WITH $moduleId
              }
              OR EXISTS {
                MATCH (focus)-[:CONTAINS_MODULE]->(m:Module)
                WHERE m.id = $moduleId OR m.id STARTS WITH $moduleId
              }
            ))
      OPTIONAL MATCH (focus)-[:DEPLOYS]->(cr:CloudResource)
      OPTIONAL MATCH (focus)-[:HAS_FINDING]->(sf:SecurityFinding)
      RETURN DISTINCT
        coalesce(focus.id, focus.name) AS repoId,
        coalesce(focus.github_full_name, focus.name, focus.id) AS repoLabel,
        coalesce(focus.role, 'repository') AS repoRole,
        coalesce(cr.id, cr.address) AS resourceId,
        coalesce(cr.name, cr.address, cr.type) AS resourceLabel,
        coalesce(cr.type, cr.address) AS resourceDetail,
        coalesce(sf.id, sf.type) AS findingId,
        coalesce(sf.type, sf.severity) AS findingLabel
      LIMIT 200
      `,
      qParams,
    );

    const focusRepoIds = new Set<string>();
    for (const rec of focusRes.records) {
      const rid = rec.get('repoId');
      if (!rid) continue;
      focusRepoIds.add(rid);
      addNode(rid, rec.get('repoLabel'), 'repository', rec.get('repoRole'));
      const resourceId = rec.get('resourceId');
      if (resourceId) {
        addNode(resourceId, rec.get('resourceLabel'), 'cloudresource', rec.get('resourceDetail'));
        addEdge(rid, resourceId, 'DEPLOYS');
      }
      const findingId = rec.get('findingId');
      if (findingId) {
        addNode(findingId, rec.get('findingLabel'), 'securityfinding');
        addEdge(rid, findingId, 'HAS_FINDING');
      }
    }

    // Upstream repos (module PROVIDED_BY) + their resources
    const upRes = await session.run(
      `
      MATCH (focus:Repository)
      WHERE ($focusId IS NOT NULL AND focus.id = $focusId)
         OR ($focusId IS NULL AND focus.id IN $fallbackIds)
      OPTIONAL MATCH (focus)-[:HAS_STACK|CONTAINS_MODULE]->()-[:REFERENCES_MODULE|USES_MODULE|CONTAINS_MODULE]->(m:Module)
      OPTIONAL MATCH (m)-[:PROVIDED_BY]->(up:Repository)
      WHERE up IS NOT NULL AND up.id <> focus.id
      OPTIONAL MATCH (up)-[:DEPLOYS]->(cr:CloudResource)
      RETURN DISTINCT
        coalesce(focus.id, focus.name) AS focusId,
        coalesce(up.id, up.name) AS upId,
        coalesce(up.github_full_name, up.name, up.id) AS upLabel,
        coalesce(up.role, 'module_source') AS upRole,
        coalesce(m.id, m.source) AS moduleId,
        coalesce(cr.id, cr.address) AS resourceId,
        coalesce(cr.name, cr.address, cr.type) AS resourceLabel,
        coalesce(cr.type, cr.address) AS resourceDetail
      LIMIT 300
      `,
      { ...qParams, fallbackIds: [...focusRepoIds] },
    );

    for (const rec of upRes.records) {
      const upId = rec.get('upId');
      const focus = rec.get('focusId');
      if (!upId || !focus) continue;
      addNode(upId, rec.get('upLabel'), 'repository', rec.get('upRole'));
      addNode(focus, focus, 'repository');
      const modId = rec.get('moduleId');
      if (modId) {
        addNode(modId, String(modId).split('/').pop() || modId, 'module', modId);
        addEdge(focus, modId, 'REFERENCES_MODULE');
        addEdge(modId, upId, 'PROVIDED_BY');
      } else {
        addEdge(focus, upId, 'DEPENDS_ON');
      }
      const resourceId = rec.get('resourceId');
      if (resourceId) {
        addNode(resourceId, rec.get('resourceLabel'), 'cloudresource', rec.get('resourceDetail'));
        addEdge(upId, resourceId, 'DEPLOYS');
      }
    }

    // Downstream consumers of modules owned/provided by focus + their resources
    const downRes = await session.run(
      `
      MATCH (focus:Repository)
      WHERE ($focusId IS NOT NULL AND focus.id = $focusId)
         OR ($focusId IS NULL AND focus.id IN $fallbackIds)
      OPTIONAL MATCH (focus)-[:CONTAINS_MODULE]->(owned:Module)
      OPTIONAL MATCH (provided:Module)-[:PROVIDED_BY]->(focus)
      WITH focus, collect(DISTINCT owned) + collect(DISTINCT provided) AS mods
      UNWIND mods AS m
      WITH focus, m
      WHERE m IS NOT NULL
      MATCH (consumer)-[:REFERENCES_MODULE|USES_MODULE|CONTAINS_MODULE]->(m)
      WHERE consumer:Repository OR consumer:Stack
      OPTIONAL MATCH (stackRepo:Repository)-[:HAS_STACK]->(consumer)
      WITH focus, m,
           coalesce(stackRepo, CASE WHEN consumer:Repository THEN consumer END) AS down
      WHERE down IS NOT NULL AND down.id <> focus.id
      OPTIONAL MATCH (down)-[:DEPLOYS]->(cr:CloudResource)
      RETURN DISTINCT
        coalesce(focus.id, focus.name) AS focusId,
        coalesce(down.id, down.name) AS downId,
        coalesce(down.github_full_name, down.name, down.id) AS downLabel,
        coalesce(down.role, 'downstream_consumer') AS downRole,
        coalesce(m.id, m.source) AS moduleId,
        coalesce(cr.id, cr.address) AS resourceId,
        coalesce(cr.name, cr.address, cr.type) AS resourceLabel,
        coalesce(cr.type, cr.address) AS resourceDetail
      LIMIT 300
      `,
      { ...qParams, fallbackIds: [...focusRepoIds] },
    );

    for (const rec of downRes.records) {
      const downId = rec.get('downId');
      const focus = rec.get('focusId');
      if (!downId || !focus) continue;
      addNode(downId, rec.get('downLabel'), 'repository', rec.get('downRole'));
      addNode(focus, focus, 'repository');
      const modId = rec.get('moduleId');
      if (modId) {
        addNode(modId, String(modId).split('/').pop() || modId, 'module', modId);
        addEdge(downId, modId, 'REFERENCES_MODULE');
        addEdge(modId, focus, 'PROVIDED_BY');
      } else {
        addEdge(focus, downId, 'CONSUMED_BY');
      }
      const resourceId = rec.get('resourceId');
      if (resourceId) {
        addNode(resourceId, rec.get('resourceLabel'), 'cloudresource', rec.get('resourceDetail'));
        addEdge(downId, resourceId, 'DEPLOYS');
      }
    }

    // Resource-level DEPENDS_ON within each included repo's resources
    const depRes = await session.run(
      `
      MATCH (r:Repository)-[:DEPLOYS]->(a:CloudResource)
      WHERE ($focusId IS NOT NULL AND (
              r.id = $focusId
              OR EXISTS {
                MATCH (focus:Repository {id: $focusId})-[:HAS_STACK|CONTAINS_MODULE]->()
                      -[:REFERENCES_MODULE|USES_MODULE]->(m:Module)-[:PROVIDED_BY]->(r)
              }
              OR EXISTS {
                MATCH (r)-[:HAS_STACK|CONTAINS_MODULE]->()-[:REFERENCES_MODULE|USES_MODULE]->(m:Module)
                WHERE (m)-[:PROVIDED_BY]->(:Repository {id: $focusId})
                   OR EXISTS { MATCH (:Repository {id: $focusId})-[:CONTAINS_MODULE]->(m) }
              }
            ))
         OR ($focusId IS NULL AND r.id IN $fallbackIds)
      MATCH (a)-[dep:DEPENDS_ON]->(b:CloudResource)
      RETURN DISTINCT
        coalesce(a.id, a.address) AS fromId,
        coalesce(b.id, b.address) AS toId,
        coalesce(a.name, a.type) AS fromLabel,
        coalesce(b.name, b.type) AS toLabel,
        coalesce(a.type, a.address) AS fromDetail,
        coalesce(b.type, b.address) AS toDetail
      LIMIT 200
      `,
      { ...qParams, fallbackIds: [...focusRepoIds] },
    );

    for (const rec of depRes.records) {
      const fromId = rec.get('fromId');
      const toId = rec.get('toId');
      if (!fromId || !toId) continue;
      addNode(fromId, rec.get('fromLabel'), 'cloudresource', rec.get('fromDetail'));
      addNode(toId, rec.get('toLabel'), 'cloudresource', rec.get('toDetail'));
      addEdge(fromId, toId, 'DEPENDS_ON');
    }
  }

  private async buildComponentSlice(
    session: any,
    params: Record<string, any>,
    depth: number,
    repoId: string | undefined,
    moduleId: string,
    addNode: (id: string, label: string, type: string, detail?: string) => void,
    addEdge: (from: string, to: string, type: string) => void,
  ) {
    // Resources owned by repos that reference this module (+ repo DEPLOYS edges)
    const owned = await session.run(
      `
      MATCH (m:Module)
      WHERE m.id = $moduleId OR m.id STARTS WITH $moduleId
      MATCH (m)<-[:REFERENCES_MODULE|USES_MODULE|CONTAINS_MODULE]-(entry)
      ${repoId ? 'WHERE (entry:Repository AND entry.id = $repoId) OR (entry:Stack AND entry.id STARTS WITH $repoId + ":")' : ''}
      OPTIONAL MATCH (entry)-[:HAS_STACK*0..1]-(r:Repository)
      WITH collect(DISTINCT coalesce(r, CASE WHEN entry:Repository THEN entry END)) AS repos
      UNWIND repos AS repo
      WITH repo
      WHERE repo IS NOT NULL
      OPTIONAL MATCH (repo)-[:DEPLOYS]->(cr:CloudResource)
      RETURN DISTINCT
        coalesce(repo.id, repo.name) AS repoId,
        coalesce(repo.github_full_name, repo.name, repo.id) AS repoLabel,
        coalesce(repo.role, 'repository') AS repoRole,
        coalesce(cr.id, cr.address, cr.name) AS resourceId,
        coalesce(cr.name, cr.address, cr.type) AS resourceLabel,
        coalesce(cr.type, cr.address) AS resourceDetail
      LIMIT 200
      `,
      params,
    );

    for (const rec of owned.records) {
      const rid = rec.get('repoId');
      const resourceId = rec.get('resourceId');
      if (rid) {
        addNode(rid, rec.get('repoLabel'), 'repository', rec.get('repoRole'));
      }
      if (resourceId) {
        addNode(resourceId, rec.get('resourceLabel'), 'cloudresource', rec.get('resourceDetail'));
        if (rid) addEdge(rid, resourceId, 'DEPLOYS');
      }
    }

    // Resource topology: typed semantic edges + generic DEPENDS_ON / REFERENCES
    const res = await session.run(
      `
      MATCH (m:Module)
      WHERE m.id = $moduleId OR m.id STARTS WITH $moduleId
      MATCH (m)<-[:REFERENCES_MODULE|USES_MODULE|CONTAINS_MODULE]-(entry)
      ${repoId ? 'WHERE (entry:Repository AND entry.id = $repoId) OR (entry:Stack AND entry.id STARTS WITH $repoId + ":")' : ''}
      MATCH (entry)-[:HAS_STACK|DEPLOYS*0..${depth}]-(cr:CloudResource)
      WITH collect(DISTINCT cr) AS resources
      UNWIND resources AS a
      MATCH (a)-[rel]->(b)
      WHERE type(rel) IN [
        'DEPENDS_ON','REFERENCES','IN_VPC','IN_SUBNET','USES_SG','ATTACHED_TO',
        'ROUTES_VIA','USES_ROUTE_TABLE','HAS_CIDR','ALLOWS_CIDR','INGRESS_FROM_SG','EGRESS_TO_SG'
      ]
        AND (b:CloudResource OR b:CIDRBlock OR b:DataSource)
      RETURN
        coalesce(a.id, a.address, a.name) AS fromId,
        coalesce(b.id, b.address, b.name, b.cidr) AS toId,
        coalesce(a.name, a.address, a.type) AS fromLabel,
        coalesce(b.name, b.address, b.type, b.cidr) AS toLabel,
        coalesce(a.type, a.address) AS fromDetail,
        coalesce(b.type, b.address, b.cidr) AS toDetail,
        labels(b)[0] AS toLabelKind,
        type(rel) AS relType
      `,
      params,
    );

    for (const rec of res.records) {
      const fromId = rec.get('fromId');
      const toId = rec.get('toId');
      if (!fromId) continue;
      addNode(fromId, rec.get('fromLabel'), 'cloudresource', rec.get('fromDetail'));
      if (toId) {
        const kind = String(rec.get('toLabelKind') || 'cloudresource').toLowerCase();
        addNode(
          toId,
          rec.get('toLabel'),
          kind === 'cidrblock' ? 'cidrblock' : kind === 'datasource' ? 'datasource' : 'cloudresource',
          rec.get('toDetail'),
        );
        addEdge(fromId, toId, rec.get('relType') || 'DEPENDS_ON');
      }
    }

    if (nodesEmpty(res) && owned.records.every((r: any) => !r.get('resourceId'))) {
      const fallback = await session.run(
        `
        MATCH (m:Module)
        WHERE m.id = $moduleId OR m.id STARTS WITH $moduleId
        MATCH (m)<-[:REFERENCES_MODULE|USES_MODULE|CONTAINS_MODULE]-(entry)
        ${repoId ? 'WHERE (entry:Repository AND entry.id = $repoId) OR (entry:Stack AND entry.id STARTS WITH $repoId + ":")' : ''}
        MATCH (entry)-[:HAS_STACK|DEPLOYS*0..${depth}]-(cr:CloudResource)
        RETURN DISTINCT
          coalesce(cr.id, cr.address, cr.name) AS id,
          coalesce(cr.name, cr.address, cr.type) AS label,
          coalesce(cr.type, cr.address) AS detail
        LIMIT 100
        `,
        params,
      );
      for (const rec of fallback.records) {
        addNode(rec.get('id'), rec.get('label'), 'cloudresource', rec.get('detail'));
      }
    }

    const findings = await session.run(
      `
      MATCH (m:Module)
      WHERE m.id = $moduleId OR m.id STARTS WITH $moduleId
      MATCH (m)<-[:REFERENCES_MODULE|USES_MODULE|CONTAINS_MODULE]-(entry)
      ${repoId ? 'WHERE (entry:Repository AND entry.id = $repoId) OR (entry:Stack AND entry.id STARTS WITH $repoId + ":")' : ''}
      MATCH (entry)-[:HAS_STACK|DEPLOYS*0..${depth}]-(cr:CloudResource)
      MATCH (r:Repository)-[:HAS_FINDING]->(sf:SecurityFinding)
      WHERE r.id = $repoId OR $repoId IS NULL
      RETURN DISTINCT
        coalesce(sf.id, sf.type) AS findingId,
        coalesce(sf.type, sf.severity) AS findingLabel,
        coalesce(cr.id, cr.address) AS resourceId
      LIMIT 20
      `,
      { ...params, repoId: repoId || null },
    );

    for (const rec of findings.records) {
      const findingId = rec.get('findingId');
      const resourceId = rec.get('resourceId');
      if (findingId) {
        addNode(findingId, rec.get('findingLabel'), 'securityfinding');
        if (resourceId) addEdge(resourceId, findingId, 'HAS_FINDING');
      }
    }
  }

  async getOrgGraph(
    repoIds: string[],
    opts: { limit?: number; includeResources?: boolean } = {},
  ) {
    const limit = opts.limit ?? 200;
    const includeResources = opts.includeResources !== false;
    const session = this.driver.session();
    const nodes: any[] = [];
    const edges: any[] = [];
    const nodeSeen = new Set<string>();

    const addNode = (id: string, label: string, type: string, detail?: string) => {
      if (!id || nodeSeen.has(id)) return;
      nodeSeen.add(id);
      const idx = nodes.length;
      nodes.push({
        id,
        label: String(label || detail || id).slice(0, 48),
        type: type.toLowerCase(),
        detail: detail || label,
        x: 80 + (idx % 10) * 85,
        y: 60 + Math.floor(idx / 10) * 70,
      });
    };
    const addEdge = (from: string, to: string, type: string) => {
      if (!from || !to || from === to) return;
      const key = `${from}|${to}|${type}`;
      if (edges.some((e) => `${e.from}|${e.to}|${e.type}` === key)) return;
      edges.push({ from, to, type });
    };

    try {
      if (!repoIds.length) {
        return { nodes, edges };
      }

      const repoRes = await session.run(
        `
        MATCH (r:Repository)
        WHERE r.id IN $repoIds
        OPTIONAL MATCH (r)-[:HAS_STACK]->(s:Stack)
        OPTIONAL MATCH (r)-[:CONTAINS_MODULE]->(m:Module)
        OPTIONAL MATCH (m)-[:PROVIDED_BY]->(up:Repository)
        OPTIONAL MATCH (s)-[:REFERENCES_MODULE|USES_MODULE]->(rm:Module)
        RETURN r, collect(DISTINCT s) AS stacks, collect(DISTINCT m) AS modules,
               collect(DISTINCT up) AS ups, collect(DISTINCT rm) AS refMods
        `,
        { repoIds },
      );

      for (const rec of repoRes.records) {
        const r = rec.get('r');
        const rid = r.properties.id;
        addNode(rid, r.properties.github_full_name || r.properties.name || rid, 'repository', r.properties.role);
        for (const s of rec.get('stacks') || []) {
          if (!s?.properties) continue;
          addNode(s.properties.id, s.properties.file || s.properties.id, 'stack');
          addEdge(rid, s.properties.id, 'HAS_STACK');
        }
        for (const m of rec.get('modules') || []) {
          if (!m?.properties) continue;
          addNode(m.properties.id, m.properties.source || m.properties.id, 'module');
          addEdge(rid, m.properties.id, 'CONTAINS_MODULE');
        }
        for (const up of rec.get('ups') || []) {
          if (!up?.properties) continue;
          addNode(up.properties.id, up.properties.name || up.properties.id, 'repository', up.properties.role);
        }
        for (const rm of rec.get('refMods') || []) {
          if (!rm?.properties) continue;
          addNode(rm.properties.id, rm.properties.source || rm.properties.id, 'module');
        }
      }

      const limitInt = neo4j.int(Math.floor(limit));

      const linkRes = await session.run(
        `
        MATCH (consumer:Repository)-[:HAS_STACK]->(:Stack)-[ref:REFERENCES_MODULE|USES_MODULE]->(m:Module)
        WHERE consumer.id IN $repoIds
        OPTIONAL MATCH (m)-[:PROVIDED_BY]->(up:Repository)
        RETURN DISTINCT consumer.id AS consumerId, m.id AS moduleId, up.id AS upId, type(ref) AS rel
        LIMIT $limit
        `,
        { repoIds, limit: limitInt },
      );
      for (const rec of linkRes.records) {
        const consumerId = rec.get('consumerId');
        const moduleId = rec.get('moduleId');
        const upId = rec.get('upId');
        if (consumerId && moduleId) {
          addNode(moduleId, String(moduleId).split('/').pop() || moduleId, 'module');
          addEdge(consumerId, moduleId, rec.get('rel') || 'REFERENCES_MODULE');
        }
        if (moduleId && upId) {
          addNode(upId, upId, 'repository');
          addEdge(moduleId, upId, 'PROVIDED_BY');
        }
      }

      if (includeResources) {
        const crRes = await session.run(
          `
          MATCH (r:Repository)-[:DEPLOYS]->(cr:CloudResource)
          WHERE r.id IN $repoIds
          OPTIONAL MATCH (cr)-[rel]->(other)
          WHERE type(rel) IN [
            'IN_VPC','IN_SUBNET','USES_SG','ATTACHED_TO','REFERENCES','DEPENDS_ON',
            'ROUTES_VIA','USES_ROUTE_TABLE','HAS_CIDR','ALLOWS_CIDR','INGRESS_FROM_SG','EGRESS_TO_SG'
          ]
          RETURN r.id AS repoId, cr, type(rel) AS relType,
                 coalesce(other.id, other.cidr) AS otherId,
                 labels(other)[0] AS otherLabel,
                 coalesce(other.type, other.cidr, other.name) AS otherDetail
          LIMIT $limit
          `,
          { repoIds, limit: limitInt },
        );
        for (const rec of crRes.records) {
          const repoId = rec.get('repoId');
          const cr = rec.get('cr');
          if (!cr?.properties) continue;
          const crId = cr.properties.id;
          addNode(crId, cr.properties.name || cr.properties.address, 'cloudresource', cr.properties.type);
          if (repoId) addEdge(repoId, crId, 'DEPLOYS');
          const otherId = rec.get('otherId');
          const relType = rec.get('relType');
          if (otherId && relType) {
            const label = String(rec.get('otherLabel') || 'cloudresource').toLowerCase();
            addNode(
              otherId,
              rec.get('otherDetail') || otherId,
              label === 'cidrblock' ? 'cidrblock' : label,
              rec.get('otherDetail'),
            );
            addEdge(crId, otherId, relType);
          }
        }
      }

      return { nodes: nodes.slice(0, limit), edges: edges.slice(0, limit * 2) };
    } finally {
      await session.close();
    }
  }

  /** Layer 1 pattern inventory: resource type counts + module sources in use. */
  async getPatternSummary(repoIds: string[]) {
    const empty = {
      resource_types: [] as { type: string; count: number }[],
      module_sources: [] as { source: string; ref: string | null; consumer_count: number }[],
      semantic_edge_types: [] as { type: string; count: number }[],
    };
    if (!repoIds.length) return empty;

    const typesRes = await this.db.query(
      `SELECT type, count(*)::int AS count
       FROM resources WHERE repo_id = ANY($1::text[])
       GROUP BY type ORDER BY count DESC, type LIMIT 40`,
      [repoIds],
    );

    const modsRes = await this.db.query(
      `SELECT module_source AS source, COALESCE(ref, version) AS ref, count(DISTINCT repo_id)::int AS consumer_count
       FROM module_references WHERE repo_id = ANY($1::text[])
       GROUP BY module_source, COALESCE(ref, version)
       ORDER BY consumer_count DESC, source LIMIT 40`,
      [repoIds],
    );

    let semantic_edge_types: { type: string; count: number }[] = [];
    const session = this.driver.session();
    try {
      const edgeRes = await session.run(
        `
        MATCH (r:Repository)-[:DEPLOYS]->(a:CloudResource)-[rel]->(b)
        WHERE r.id IN $repoIds
          AND type(rel) IN [
            'IN_VPC','IN_SUBNET','USES_SG','ATTACHED_TO','ROUTES_VIA','USES_ROUTE_TABLE',
            'HAS_CIDR','ALLOWS_CIDR','INGRESS_FROM_SG','EGRESS_TO_SG','DEPENDS_ON','REFERENCES'
          ]
        RETURN type(rel) AS relType, count(*) AS c
        ORDER BY c DESC
        LIMIT 20
        `,
        { repoIds },
      );
      semantic_edge_types = edgeRes.records.map((rec) => ({
        type: String(rec.get('relType')),
        count: this.toNum(rec.get('c')),
      }));
    } catch {
      semantic_edge_types = [];
    } finally {
      await session.close();
    }

    return {
      resource_types: typesRes.rows.map((r) => ({ type: r.type, count: r.count })),
      module_sources: modsRes.rows.map((r) => ({
        source: r.source,
        ref: r.ref || null,
        consumer_count: r.consumer_count,
      })),
      semantic_edge_types,
    };
  }

  /**
   * Layer 2 — same topology as org graph, scoped to APPSVN-tagged repos
   * (and optionally CloudResources whose appsvn property matches).
   */
  async getApplicationGraph(
    appsvn: string,
    repoIds: string[],
    opts: { limit?: number; includeResources?: boolean } = {},
  ) {
    const base = await this.getOrgGraph(repoIds, opts);
    // Prefer Neo4j appsvn property when present (post-rescan); otherwise repo filter is enough.
    if (!appsvn || !opts.includeResources) return base;

    const limit = opts.limit ?? 200;
    const session = this.driver.session();
    const nodes = [...(base.nodes || [])];
    const edges = [...(base.edges || [])];
    const nodeSeen = new Set(nodes.map((n) => n.id));

    const addNode = (id: string, label: string, type: string, detail?: string) => {
      if (!id || nodeSeen.has(id)) return;
      nodeSeen.add(id);
      const idx = nodes.length;
      nodes.push({
        id,
        label: String(label || detail || id).slice(0, 48),
        type: type.toLowerCase(),
        detail: detail || label,
        x: 80 + (idx % 10) * 85,
        y: 60 + Math.floor(idx / 10) * 70,
      });
    };
    const addEdge = (from: string, to: string, type: string) => {
      if (!from || !to || from === to) return;
      const key = `${from}|${to}|${type}`;
      if (edges.some((e) => `${e.from}|${e.to}|${e.type}` === key)) return;
      edges.push({ from, to, type });
    };

    try {
      const limitInt = neo4j.int(Math.floor(limit));
      const tagged = await session.run(
        `
        MATCH (r:Repository)-[:DEPLOYS]->(cr:CloudResource)
        WHERE (r.id IN $repoIds OR cr.appsvn = $appsvn OR r.appsvn = $appsvn)
        OPTIONAL MATCH (cr)-[rel]->(other)
        WHERE type(rel) IN [
          'IN_VPC','IN_SUBNET','USES_SG','ATTACHED_TO','REFERENCES','DEPENDS_ON',
          'ROUTES_VIA','USES_ROUTE_TABLE','HAS_CIDR','ALLOWS_CIDR','INGRESS_FROM_SG','EGRESS_TO_SG'
        ]
        RETURN r.id AS repoId,
               coalesce(r.github_full_name, r.name, r.id) AS repoLabel,
               coalesce(r.role, 'repository') AS repoRole,
               cr, type(rel) AS relType,
               coalesce(other.id, other.cidr) AS otherId,
               labels(other)[0] AS otherLabel,
               coalesce(other.type, other.cidr, other.name) AS otherDetail
        LIMIT $limit
        `,
        { repoIds, appsvn, limit: limitInt },
      );
      for (const rec of tagged.records) {
        const repoId = rec.get('repoId');
        if (repoId) addNode(repoId, rec.get('repoLabel'), 'repository', rec.get('repoRole'));
        const cr = rec.get('cr');
        if (!cr?.properties) continue;
        const crId = cr.properties.id;
        addNode(crId, cr.properties.name || cr.properties.address, 'cloudresource', cr.properties.type);
        if (repoId) addEdge(repoId, crId, 'DEPLOYS');
        const otherId = rec.get('otherId');
        const relType = rec.get('relType');
        if (otherId && relType) {
          const label = String(rec.get('otherLabel') || 'cloudresource').toLowerCase();
          addNode(
            otherId,
            rec.get('otherDetail') || otherId,
            label === 'cidrblock' ? 'cidrblock' : label,
            rec.get('otherDetail'),
          );
          addEdge(crId, otherId, relType);
        }
      }
      return { nodes: nodes.slice(0, limit), edges: edges.slice(0, limit * 2) };
    } catch {
      return base;
    } finally {
      await session.close();
    }
  }

  async clearAll(): Promise<number> {
    const session = this.driver.session();
    try {
      const countRes = await session.run('MATCH (n) RETURN count(n) AS c');
      const count = this.toNum(countRes.records[0]?.get('c'));
      await session.run('MATCH (n) DETACH DELETE n');
      return count;
    } finally {
      await session.close();
    }
  }
}

function nodesEmpty(res: { records: unknown[] }): boolean {
  return !res.records.some((r: any) => r.get('fromId'));
}
