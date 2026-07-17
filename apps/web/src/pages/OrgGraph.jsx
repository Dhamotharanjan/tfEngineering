import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Network, Wifi, WifiOff } from 'lucide-react';
import Header from '../components/Header';
import DependencyGraph from '../components/DependencyGraph';
import { PageShell, SectionTitle } from '../components/ui';
import { api } from '../api/client';

export default function OrgGraph() {
  const [data, setData] = useState(null);
  const [live, setLive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedNodeId, setSelectedNodeId] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await api.orgGraph({ limit: 250, include: 'resources' });
        if (!cancelled) {
          setData(res);
          setLive(true);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) {
          setLive(false);
          setError(e.message);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const graph = data?.graph || { nodes: [], edges: [] };
  const displayGraph = useMemo(() => {
    if (!selectedNodeId) return graph;
    const neighborIds = new Set([selectedNodeId]);
    for (const e of graph.edges || []) {
      if (e.from === selectedNodeId) neighborIds.add(e.to);
      if (e.to === selectedNodeId) neighborIds.add(e.from);
    }
    return {
      nodes: (graph.nodes || []).filter((n) => neighborIds.has(n.id)),
      edges: (graph.edges || []).filter((e) => neighborIds.has(e.from) && neighborIds.has(e.to)),
    };
  }, [graph, selectedNodeId]);

  return (
    <PageShell
      header={
        <Header
          title="Org Knowledge Graph"
          subtitle={`acme-bank · subscribed repos → Neo4j topology${live ? ' · live' : ''}`}
          actions={
            <div className="flex items-center gap-2">
              <span className={`badge-${live ? 'success' : 'neutral'} flex items-center gap-1`}>
                {live ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
                {live ? 'Live' : 'Offline'}
              </span>
              <Link to="/repos" className="btn-secondary">Subscriptions</Link>
              <Link to="/dependencies" className="btn-primary inline-flex items-center gap-1.5">
                <Network className="h-3.5 w-3.5" />
                Dependency tree
              </Link>
            </div>
          }
        />
      }
    >
      <div className="mb-4 flex flex-wrap gap-2">
        <span className="badge-info">{data?.counts?.repositories ?? 0} subscribed repos</span>
        <span className="badge-neutral">{data?.counts?.graph_nodes ?? 0} graph nodes</span>
        <span className="badge-neutral">{data?.counts?.graph_edges ?? 0} edges</span>
        {data?.store_status && (
          <>
            <span className={`badge-${data.store_status.neo4j === 'ok' ? 'success' : 'warning'}`}>
              neo4j: {data.store_status.neo4j}
            </span>
            <span className={`badge-${data.store_status.postgres === 'ok' ? 'success' : 'warning'}`}>
              postgres: {data.store_status.postgres}
            </span>
          </>
        )}
      </div>

      {error && <p className="mb-4 text-xs text-amber-400">{error}</p>}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <SectionTitle>Org-wide graph</SectionTitle>
          <div className="card">
            <div className="card-body">
              {loading ? (
                <div className="flex h-[520px] items-center justify-center text-sm text-slate-500">
                  Loading org graph…
                </div>
              ) : (
                <DependencyGraph
                  nodes={displayGraph.nodes}
                  edges={displayGraph.edges}
                  selectedNodeId={selectedNodeId}
                  onNodeClick={(n) => setSelectedNodeId((prev) => (prev === n.id ? null : n.id))}
                  slice="lineage"
                  height={520}
                />
              )}
            </div>
          </div>
        </div>

        <div>
          <SectionTitle>Subscribed inventory</SectionTitle>
          <div className="card max-h-[560px] overflow-y-auto p-3">
            {(data?.subscribed_repos || []).map((r) => (
              <div key={r.id} className="mb-2 rounded-lg border border-white/10 px-3 py-2">
                <div className="font-mono text-[11px] text-brand-300">{r.name || r.id}</div>
                <div className="mt-1 flex flex-wrap gap-1.5 text-[10px]">
                  <span className={`badge-${r.role === 'module_source' ? 'info' : 'neutral'}`}>
                    {String(r.role).replace(/_/g, ' ')}
                  </span>
                  <span className="badge-neutral">{r.resource_count} resources</span>
                </div>
              </div>
            ))}
            {!data?.subscribed_repos?.length && (
              <p className="text-xs text-slate-500">No subscribed repos — enable them on Repo Subscriptions.</p>
            )}
          </div>
        </div>
      </div>
    </PageShell>
  );
}
