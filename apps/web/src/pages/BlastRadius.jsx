import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ChevronDown, Wifi, WifiOff } from 'lucide-react';
import Header from '../components/Header';
import DependencyGraph from '../components/DependencyGraph';
import { PageShell, SectionTitle } from '../components/ui';
import { api } from '../api/client';
import {
  DEFAULT_MODULE_SLUG,
  MODULE_CATALOG,
  defaultRepoForModuleSlug,
  resolveBlastRadiusModule,
} from '../config/blastRadiusModules';
import { formatNodeTypeLabel, resolveNodeVisual } from '../components/graphNodeVisuals';

const SLICES = [
  { id: 'lineage', label: 'Upstream / Downstream' },
  { id: 'component', label: 'Resources (Layer 1)' },
];

const MOCK_SUBSCRIPTIONS = [
  { id: 'upstream-core-network-modules', name: 'acme/terraform-modules-vpc', role: 'module_source' },
  { id: 'team-database-platform-infra', name: 'acme/infra-payments-prod', role: 'downstream_consumer' },
  { id: 'repo-a', name: 'acme/infra-checkout-stg', role: 'downstream_consumer' },
];

const MOCK_GRAPH = {
  nodes: [
    { id: 'upstream-core-network-modules', label: 'vpc-modules', type: 'repository', detail: 'acme/terraform-modules-vpc' },
    { id: 'modules-vpc', label: 'modules/vpc', type: 'module', detail: 'terraform-aws-modules/vpc' },
    { id: 'team-database-platform-infra', label: 'payments-prod', type: 'repository', detail: 'acme/infra-payments-prod', pci: true },
    { id: 'repo-a', label: 'checkout-stg', type: 'repository', detail: 'acme/infra-checkout-stg' },
    { id: 'stack-payments', label: 'payments-vpc', type: 'stack' },
    { id: 'cr-subnet-a', label: 'aws_subnet.a', type: 'cloudresource', provider: 'aws' },
    { id: 'ds-rds', label: 'data.aws_rds', type: 'datasource', provider: 'aws' },
    { id: 'var-vpc-cidr', label: 'var.vpc_cidr', type: 'variable' },
    { id: 'finding-sg', label: 'SG open :22', type: 'securityfinding', severity: 'high' },
  ],
  edges: [
    { from: 'upstream-core-network-modules', to: 'modules-vpc', type: 'PUBLISHES' },
    { from: 'modules-vpc', to: 'team-database-platform-infra', type: 'REFERENCES_MODULE' },
    { from: 'modules-vpc', to: 'repo-a', type: 'REFERENCES_MODULE' },
    { from: 'team-database-platform-infra', to: 'stack-payments', type: 'HAS_STACK' },
    { from: 'stack-payments', to: 'cr-subnet-a', type: 'DEPLOYS' },
    { from: 'stack-payments', to: 'ds-rds', type: 'DEPENDS_ON' },
    { from: 'stack-payments', to: 'var-vpc-cidr', type: 'DEPENDS_ON' },
    { from: 'cr-subnet-a', to: 'finding-sg', type: 'HAS_FINDING' },
  ],
};

const MOCK_RESOURCES = {
  resources: [
    { id: 'aws_vpc.main', type: 'aws_vpc', name: 'main', provider: 'aws', stack_id: 'payments-vpc' },
    { id: 'aws_subnet.a', type: 'aws_subnet', name: 'private-a', provider: 'aws', stack_id: 'payments-vpc' },
    { id: 'aws_security_group.web', type: 'aws_security_group', name: 'web', provider: 'aws', stack_id: 'payments-vpc' },
  ],
};

const MOCK_UPSTREAM_LAYERS = { count: 2, layers: [{ layer: 1, modules: ['modules-vpc'] }, { layer: 2, modules: ['modules-kms'] }] };

const MOCK_STORE_STATUS = { neo4j: 'ok', postgres: 'ok', redis: 'ok' };

function filterSubgraph(graph, selectedNodeId) {
  if (!selectedNodeId || !graph?.nodes?.length) return graph;
  const neighborIds = new Set([selectedNodeId]);
  for (const e of graph.edges || []) {
    if (e.from === selectedNodeId) neighborIds.add(e.to);
    if (e.to === selectedNodeId) neighborIds.add(e.from);
  }
  return {
    nodes: graph.nodes.filter((n) => neighborIds.has(n.id)),
    edges: (graph.edges || []).filter((e) => neighborIds.has(e.from) && neighborIds.has(e.to)),
  };
}

export default function BlastRadius() {
  const { moduleId: routeModuleId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();

  const initialModuleSlug = routeModuleId || DEFAULT_MODULE_SLUG;
  const initialRepoId = searchParams.get('repoId') || defaultRepoForModuleSlug(initialModuleSlug);

  const [slice, setSlice] = useState(searchParams.get('slice') || 'lineage');
  const [repoId, setRepoId] = useState(initialRepoId);
  const [moduleSlug, setModuleSlug] = useState(initialModuleSlug);
  const [depth, setDepth] = useState(Number(searchParams.get('depth')) || 3);
  const [selectedNodeId, setSelectedNodeId] = useState(null);

  // Keep state in sync when navigating from Dependency Tree clicks
  useEffect(() => {
    const nextSlug = routeModuleId || DEFAULT_MODULE_SLUG;
    const nextRepo = searchParams.get('repoId') || defaultRepoForModuleSlug(nextSlug);
    const nextSlice = searchParams.get('slice') || 'lineage';
    const nextDepth = Number(searchParams.get('depth')) || 3;
    setModuleSlug(nextSlug);
    setRepoId(nextRepo);
    setSlice(nextSlice);
    setDepth(nextDepth);
    setSelectedNodeId(null);
  }, [routeModuleId, searchParams]);

  const [subscriptions, setSubscriptions] = useState(MOCK_SUBSCRIPTIONS);
  const [subsLive, setSubsLive] = useState(false);

  const [graphData, setGraphData] = useState(null);
  const [graphLive, setGraphLive] = useState(false);
  const [graphLoading, setGraphLoading] = useState(true);

  const [resources, setResources] = useState(null);
  const [resourcesLive, setResourcesLive] = useState(false);

  const [upstreamLayers, setUpstreamLayers] = useState(null);
  const [upstreamLive, setUpstreamLive] = useState(false);

  const [storeStatus, setStoreStatus] = useState(MOCK_STORE_STATUS);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await api.subscriptions();
        if (!cancelled) {
          setSubscriptions(data);
          setSubsLive(true);
          if (!searchParams.get('repoId') && !repoId && data.length) {
            setRepoId(defaultRepoForModuleSlug(moduleSlug));
          }
        }
      } catch {
        if (!cancelled) {
          setSubscriptions(MOCK_SUBSCRIPTIONS);
          setSubsLive(false);
          if (!repoId) setRepoId(defaultRepoForModuleSlug(moduleSlug));
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const params = new URLSearchParams();
    if (slice && slice !== 'lineage') params.set('slice', slice);
    else params.set('slice', 'lineage');
    if (repoId) params.set('repoId', repoId);
    if (depth !== 3) params.set('depth', String(depth));
    setSearchParams(params, { replace: true });
  }, [slice, repoId, depth, setSearchParams]);

  useEffect(() => {
    let cancelled = false;
    setGraphLoading(true);
    setError(null);
    const apiModuleId = resolveBlastRadiusModule(moduleSlug).moduleId;
    (async () => {
      try {
        const data = await api.blastRadiusGraph(apiModuleId, { slice, repoId, depth });
        if (!cancelled) {
          setGraphData(data);
          setGraphLive(true);
          if (data.store_status) setStoreStatus(data.store_status);
        }
      } catch (e) {
        if (!cancelled) {
          setGraphData({
            graph: MOCK_GRAPH,
            counts: {
              repositories: 4,
              modules: 3,
              stacks: 2,
              cloud_resources: 5,
            },
            store_status: MOCK_STORE_STATUS,
          });
          setGraphLive(false);
          setStoreStatus(MOCK_STORE_STATUS);
          setError(e.message);
        }
      } finally {
        if (!cancelled) setGraphLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [moduleSlug, slice, repoId, depth]);

  useEffect(() => {
    if (!repoId) {
      setResources(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const data = await api.repoResources(repoId);
        if (!cancelled) {
          setResources(data);
          setResourcesLive(true);
        }
      } catch {
        if (!cancelled) {
          setResources(MOCK_RESOURCES);
          setResourcesLive(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [repoId]);

  useEffect(() => {
    if (!repoId) {
      setUpstreamLayers(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const data = await api.repoUpstreamLayers(repoId);
        if (!cancelled) {
          setUpstreamLayers(data);
          setUpstreamLive(true);
        }
      } catch {
        if (!cancelled) {
          setUpstreamLayers(MOCK_UPSTREAM_LAYERS);
          setUpstreamLive(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [repoId]);

  const moduleOptions = useMemo(() => {
    const merged = MODULE_CATALOG.map((m) => ({ id: m.slug, label: m.label }));
    const seen = new Set(merged.map((m) => m.id));
    for (const n of graphData?.graph?.nodes || []) {
      if (String(n.type).toLowerCase().replace(/_/g, '') !== 'module') continue;
      const slug = resolveBlastRadiusModule(n.id).slug;
      if (!seen.has(slug)) {
        seen.add(slug);
        merged.push({ id: slug, label: n.label || slug });
      }
    }
    return merged;
  }, [graphData]);

  const displayGraph = useMemo(() => {
    if (graphData?.graph?.nodes?.length) {
      return filterSubgraph(graphData.graph, selectedNodeId);
    }
    if (graphLive) {
      return { nodes: [], edges: [] };
    }
    return filterSubgraph(MOCK_GRAPH, selectedNodeId);
  }, [graphData, graphLive, selectedNodeId]);

  const counts = graphData?.counts || {};
  const upstreamCount = upstreamLayers?.count ?? upstreamLayers?.layers?.length ?? 0;

  const handleNodeClick = useCallback((node) => {
    setSelectedNodeId((prev) => (prev === node.id ? null : node.id));
    const type = String(node.type).toLowerCase().replace(/_/g, '');
    if (type === 'module') {
      const slug = resolveBlastRadiusModule(node.id).slug;
      setModuleSlug(slug);
      const nextRepo = defaultRepoForModuleSlug(slug);
      if (nextRepo) setRepoId(nextRepo);
    }
    if (type === 'repository') setRepoId(node.id);
  }, []);

  const hasLiveGraph = graphLive && (graphData?.graph?.nodes?.length ?? 0) > 0;
  const live = hasLiveGraph || subsLive;

  return (
    <PageShell
      header={
        <Header
          title="Blast Radius Analysis"
          subtitle={
            slice === 'lineage'
              ? `Layer 1 technical lineage · upstream ↔ downstream repos and AWS resources${repoId ? ` · focus: ${repoId}` : ''}${live ? ' · live' : ''}`
              : `Layer 1 resource topology · AWS resources and semantic edges${repoId ? ` · ${repoId}` : ''}${live ? ' · live' : ' · mock'}`
          }
          actions={
            <div className="flex items-center gap-2">
              <span className={`badge-${live ? 'success' : 'neutral'} flex items-center gap-1`}>
                {live ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
                {live ? 'Live' : 'Mock'}
              </span>
              <Link to="/graph/infra?tab=patterns" className="btn-secondary">Infra Graph</Link>
              <Link to="/dependencies" className="btn-secondary">Dependency tree</Link>
              <Link to="/plans/change" className="btn-primary">Generate Change Plan</Link>
            </div>
          }
        />
      }
    >
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex rounded-lg border border-white/10 p-0.5">
          {SLICES.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                slice === s.id ? 'bg-brand-500/20 text-brand-300 ring-1 ring-brand-500/30' : 'text-slate-400 hover:text-white'
              }`}
              onClick={() => {
                setSlice(s.id);
                setSelectedNodeId(null);
              }}
            >
              {s.label}
            </button>
          ))}
        </div>

        <select
          className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-200"
          value={repoId}
          onChange={(e) => {
            setRepoId(e.target.value);
            setSelectedNodeId(null);
          }}
        >
          <option value="">All repos</option>
          {subscriptions.map((r) => (
            <option key={r.id} value={r.id}>{r.name || r.id}</option>
          ))}
        </select>

        <select
          className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-200"
          value={moduleSlug}
          onChange={(e) => {
            const slug = e.target.value;
            setModuleSlug(slug);
            setRepoId(defaultRepoForModuleSlug(slug));
            setSelectedNodeId(null);
          }}
        >
          {moduleOptions.map((m) => (
            <option key={m.id} value={m.id}>{m.label}</option>
          ))}
        </select>

        <select
          className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-200"
          value={depth}
          onChange={(e) => setDepth(Number(e.target.value))}
        >
          {[1, 2, 3, 4, 5].map((d) => (
            <option key={d} value={d}>Depth {d}</option>
          ))}
        </select>

        {repoId && (
          <span className="badge-info">
            {upstreamCount} upstream layer{upstreamCount === 1 ? '' : 's'}
            {!upstreamLive && ' · mock'}
          </span>
        )}
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <span className="badge-warning">{counts.stacks || 0} stacks</span>
        <span className="badge-info">{counts.repositories || 0} repos</span>
        <span className="badge-neutral">{counts.cloud_resources || 0} resources</span>
        <span className="badge-neutral">{counts.modules || 0} modules</span>
        {Object.entries(storeStatus).map(([store, status]) => (
          <span key={store} className={`badge-${status === 'ok' ? 'success' : 'warning'}`}>
            {store}: {status}
          </span>
        ))}
      </div>

      {error && !graphLive && (
        <p className="mb-4 text-xs text-amber-400/90">API unavailable — showing mock graph ({error})</p>
      )}

      {graphLive && !graphLoading && !displayGraph.nodes.length && (
        <p className="mb-4 text-xs text-slate-400">
          No graph nodes for this module/repo filter — try another module from the dropdown or run a scan.
        </p>
      )}

      <div className={`grid gap-6 ${repoId ? 'lg:grid-cols-3' : ''}`}>
        <div className={repoId ? 'lg:col-span-2' : ''}>
          <div className="card mb-6">
            <div className="card-header flex items-center justify-between">
              <div>
                <h3 className="font-semibold">
                  {slice === 'lineage' ? 'Upstream / Downstream resource graph' : 'Resource dependency graph'}
                </h3>
                <p className="text-xs text-slate-500">
                  {slice === 'lineage'
                    ? 'Repos linked by module lineage · AWS resources under each repo · '
                    : 'Click a node to drill down · '}
                  scroll to zoom · drag to pan ·{' '}
                  {graphLoading
                    ? 'loading…'
                    : hasLiveGraph
                      ? 'live Neo4j data'
                      : graphLive
                        ? 'live API · empty graph'
                        : 'mock fallback'}
                </p>
              </div>
              {selectedNodeId && (
                <button type="button" className="btn-secondary text-xs" onClick={() => setSelectedNodeId(null)}>
                  Clear selection
                </button>
              )}
            </div>
            <div className="card-body">
              {graphLoading ? (
                <div className="flex h-[520px] items-center justify-center text-sm text-slate-500">Loading graph…</div>
              ) : (
                <DependencyGraph
                  nodes={displayGraph.nodes}
                  edges={displayGraph.edges}
                  selectedNodeId={selectedNodeId}
                  onNodeClick={handleNodeClick}
                  slice={slice}
                  height={520}
                />
              )}
            </div>
          </div>
        </div>

        {repoId && (
          <div>
            <SectionTitle>
              {slice === 'lineage' ? 'Focus repo inventory' : 'Resource inventory'}
            </SectionTitle>
            <div className="card overflow-hidden">
              <div className="card-header">
                <p className="text-xs text-slate-500">
                  {repoId ? `${repoId} · ` : ''}{resourcesLive ? 'live' : 'mock'}
                </p>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10 text-left text-xs text-slate-500">
                    <th className="px-4 py-2">Resource</th>
                    <th className="px-4 py-2">Type</th>
                    <th className="px-4 py-2">Stack</th>
                  </tr>
                </thead>
                <tbody>
                  {(resources?.resources || []).map((r) => {
                    const visual = resolveNodeVisual({
                      type: 'cloudresource',
                      detail: r.type,
                      id: `${repoId}:${r.id}`,
                      label: r.name,
                    });
                    const { Icon } = visual;
                    return (
                    <tr key={r.id} className="table-row">
                      <td className="px-4 py-2 font-mono text-xs text-brand-300">
                        <span className="inline-flex items-center gap-2">
                          <span
                            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
                            style={{ background: visual.fill, color: visual.icon || '#fff' }}
                            title={formatNodeTypeLabel({ type: 'cloudresource', detail: r.type })}
                          >
                            <Icon size={13} strokeWidth={2.25} />
                          </span>
                          {r.id}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-slate-400">{formatNodeTypeLabel({ type: 'cloudresource', detail: r.type })}</td>
                      <td className="px-4 py-2 text-slate-500">{r.stack_id || '—'}</td>
                    </tr>
                    );
                  })}
                  {!resources?.resources?.length && (
                    <tr>
                      <td colSpan={3} className="px-4 py-6 text-center text-xs text-slate-500">
                        No resources for this repo
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {graphData?.downstream_plans?.length > 0 && (
        <>
          <SectionTitle>Downstream rollout plans</SectionTitle>
          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 text-left text-xs text-slate-500">
                  <th className="px-5 py-3">Repo</th>
                  <th className="px-5 py-3">Strategy</th>
                  <th className="px-5 py-3">Version gap</th>
                </tr>
              </thead>
              <tbody>
                {graphData.downstream_plans.map((p) => (
                  <tr key={p.downstream_repo} className="table-row">
                    <td className="px-5 py-3 font-mono text-xs">{p.downstream_repo}</td>
                    <td className="px-5 py-3">{p.strategy}</td>
                    <td className="px-5 py-3">{p.version_gap}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </PageShell>
  );
}
