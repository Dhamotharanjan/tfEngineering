import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { CheckCircle2, Layers, Network, ShieldCheck, Wifi, WifiOff } from 'lucide-react';
import Header from '../components/Header';
import DependencyGraph from '../components/DependencyGraph';
import { PageShell, SectionTitle } from '../components/ui';
import { api } from '../api/client';
import { DEFAULT_MODULE_SLUG } from '../config/blastRadiusModules';

const TABS = [
  { id: 'patterns', label: 'Patterns', layer: 'Layer 1' },
  { id: 'application', label: 'By Application', layer: 'Layer 2' },
];

const FAMILY_FALLBACK = [
  { id: 'RDS-PGSQL', label: 'RDS PostgreSQL' },
  { id: 'RDS-MSSQL', label: 'RDS SQL Server' },
  { id: 'RDS-APGSQL', label: 'Aurora PostgreSQL' },
  { id: 'Ec2Oracle', label: 'EC2 Oracle' },
];

export default function InfraGraph() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const tab = searchParams.get('tab') === 'application' ? 'application' : 'patterns';
  const appsvnParam = searchParams.get('appsvn') || '';
  const familyParam = searchParams.get('family') || '';
  const patternParam = searchParams.get('patternId') || '';

  const [apps, setApps] = useState([]);
  const [selectedAppsvn, setSelectedAppsvn] = useState(appsvnParam);
  const [families, setFamilies] = useState(FAMILY_FALLBACK);
  const [selectedFamily, setSelectedFamily] = useState(familyParam);
  const [selectedPatternId, setSelectedPatternId] = useState(patternParam);
  const [catalog, setCatalog] = useState([]);
  const [data, setData] = useState(null);
  const [live, setLive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [stampForm, setStampForm] = useState({
    auditor: 'external-auditor',
    comment: '',
    compliance_framework: 'SOC2',
  });
  const [stampBusy, setStampBusy] = useState(false);
  const [stampMsg, setStampMsg] = useState(null);
  const [architecture, setArchitecture] = useState(null);
  const [archLoading, setArchLoading] = useState(false);
  const [archError, setArchError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.listApps();
        if (cancelled) return;
        const list = res.apps || [];
        setApps(list);
        if (!selectedAppsvn && list.length) {
          setSelectedAppsvn(list[0].appsvn);
        }
      } catch {
        /* picker can stay empty until Layer 2 load */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (appsvnParam && appsvnParam !== selectedAppsvn) {
      setSelectedAppsvn(appsvnParam);
    }
  }, [appsvnParam]);

  useEffect(() => {
    setSelectedFamily(familyParam);
    setSelectedPatternId(patternParam);
  }, [familyParam, patternParam]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setSelectedNodeId(null);
      setStampMsg(null);
      try {
        let res;
        if (tab === 'application') {
          if (!selectedAppsvn) {
            if (!cancelled) {
              setData(null);
              setLive(false);
              setError(null);
              setCatalog([]);
              setLoading(false);
            }
            return;
          }
          res = await api.applicationGraph({ appsvn: selectedAppsvn, limit: 250, include: 'resources' });
          if (!cancelled) {
            setData(res);
            setCatalog([]);
            setLive(true);
            setError(null);
          }
        } else {
          const [graphRes, famRes] = await Promise.all([
            api.patternsGraph({
              limit: 250,
              include: 'resources',
              family: selectedFamily || undefined,
              patternId: selectedPatternId || undefined,
            }),
            api.patternFamilies().catch(() => null),
          ]);
          if (!cancelled) {
            setData(graphRes);
            setCatalog(graphRes.catalog || graphRes.patterns?.catalog || []);
            if (famRes?.families?.length) setFamilies(famRes.families);
            else if (graphRes.families?.length) setFamilies(graphRes.families);
            setLive(true);
            setError(null);
          }
        }
      } catch (e) {
        if (!cancelled) {
          setLive(false);
          setError(e.message);
          setData(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tab, selectedAppsvn, selectedFamily, selectedPatternId]);

  useEffect(() => {
    if (tab !== 'patterns' || !selectedPatternId) {
      setArchitecture(null);
      setArchError(null);
      return undefined;
    }
    let cancelled = false;
    (async () => {
      setArchLoading(true);
      setArchError(null);
      try {
        const res = await api.patternArchitecture(selectedPatternId);
        if (!cancelled) setArchitecture(res);
      } catch (e) {
        if (!cancelled) {
          setArchitecture(null);
          setArchError(e.message);
        }
      } finally {
        if (!cancelled) setArchLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tab, selectedPatternId]);

  const setTab = (next) => {
    const params = new URLSearchParams(searchParams);
    params.set('tab', next);
    if (next === 'application' && selectedAppsvn) {
      params.set('appsvn', selectedAppsvn);
      params.delete('family');
      params.delete('patternId');
    } else {
      params.delete('appsvn');
      if (selectedFamily) params.set('family', selectedFamily);
      else params.delete('family');
      if (selectedPatternId) params.set('patternId', selectedPatternId);
      else params.delete('patternId');
    }
    setSearchParams(params);
  };

  const onPickAppsvn = (value) => {
    setSelectedAppsvn(value);
    const params = new URLSearchParams(searchParams);
    params.set('tab', 'application');
    if (value) params.set('appsvn', value);
    else params.delete('appsvn');
    setSearchParams(params);
  };

  const onPickFamily = (value) => {
    setSelectedFamily(value);
    setSelectedPatternId('');
    const params = new URLSearchParams(searchParams);
    params.set('tab', 'patterns');
    if (value) params.set('family', value);
    else params.delete('family');
    params.delete('patternId');
    setSearchParams(params);
  };

  const onPickPattern = (patternId) => {
    const next = selectedPatternId === patternId ? '' : patternId;
    setSelectedPatternId(next);
    const params = new URLSearchParams(searchParams);
    params.set('tab', 'patterns');
    if (selectedFamily) params.set('family', selectedFamily);
    if (next) params.set('patternId', next);
    else params.delete('patternId');
    setSearchParams(params);
  };

  const visibleCatalog = useMemo(() => {
    let rows = catalog || [];
    if (selectedFamily) rows = rows.filter((p) => p.family === selectedFamily);
    return rows;
  }, [catalog, selectedFamily]);

  const selectedPattern = useMemo(
    () => visibleCatalog.find((p) => p.pattern_id === selectedPatternId) || null,
    [visibleCatalog, selectedPatternId],
  );

  const graph = data?.graph || { nodes: [], edges: [] };
  const architectureGraph = architecture?.graph || architecture || null;
  const displayGraph = useMemo(() => {
    const base =
      tab === 'patterns' && selectedPatternId && architectureGraph?.nodes?.length
        ? { nodes: architectureGraph.nodes, edges: architectureGraph.edges || [] }
        : graph;
    if (!selectedNodeId) return base;
    const neighborIds = new Set([selectedNodeId]);
    for (const e of base.edges || []) {
      if (e.from === selectedNodeId) neighborIds.add(e.to);
      if (e.to === selectedNodeId) neighborIds.add(e.from);
    }
    return {
      nodes: (base.nodes || []).filter((n) => neighborIds.has(n.id)),
      edges: (base.edges || []).filter((e) => neighborIds.has(e.from) && neighborIds.has(e.to)),
    };
  }, [graph, selectedNodeId, tab, selectedPatternId, architectureGraph]);

  const showingArchitecture = tab === 'patterns' && !!selectedPatternId && !!architectureGraph?.nodes?.length;

  const patterns = data?.patterns;
  const title = tab === 'application' ? 'Infra Graph · By Application' : 'Infra Graph · Patterns';
  const subtitle =
    tab === 'application'
      ? `Layer 2 · APPSVN-scoped repos/stacks/resources${data?.application_label ? ` · ${data.application_label}` : ''}${live ? ' · live' : ''}`
      : `Layer 1 · Resource-family patterns · simple/complex · auditor stamp${selectedFamily ? ` · ${selectedFamily}` : ''}${selectedPatternId ? ` · ${selectedPatternId}` : ''}${live ? ' · live' : ''}`;

  const onStamp = async () => {
    if (!selectedPatternId) return;
    setStampBusy(true);
    setStampMsg(null);
    try {
      const res = await api.stampPattern(selectedPatternId, stampForm);
      setStampMsg(res.message || 'Stamped');
      const [refreshed, arch] = await Promise.all([
        api.patternsGraph({
          limit: 250,
          include: 'resources',
          family: selectedFamily || undefined,
          patternId: selectedPatternId || undefined,
        }),
        api.patternArchitecture(selectedPatternId).catch(() => null),
      ]);
      setData(refreshed);
      setCatalog(refreshed.catalog || refreshed.patterns?.catalog || []);
      if (arch) setArchitecture(arch);
    } catch (e) {
      setStampMsg(e.message);
    } finally {
      setStampBusy(false);
    }
  };

  return (
    <PageShell
      header={
        <Header
          title={title}
          subtitle={subtitle}
          actions={
            <div className="flex items-center gap-2">
              <span className={`badge-${live ? 'success' : 'neutral'} flex items-center gap-1`}>
                {live ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
                {live ? 'Live' : 'Offline'}
              </span>
              <Link to={`/impact/${DEFAULT_MODULE_SLUG}`} className="btn-secondary inline-flex items-center gap-1.5">
                <Network className="h-3.5 w-3.5" />
                Blast Radius
              </Link>
              <Link to="/dependencies" className="btn-primary inline-flex items-center gap-1.5">
                <Layers className="h-3.5 w-3.5" />
                Dependency tree
              </Link>
            </div>
          }
        />
      }
    >
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
              tab === t.id
                ? 'bg-brand-500/20 text-brand-200 ring-1 ring-brand-500/40'
                : 'bg-white/5 text-slate-400 hover:bg-white/10 hover:text-slate-200'
            }`}
          >
            <span className="mr-1.5 text-[10px] uppercase tracking-wide text-slate-500">{t.layer}</span>
            {t.label}
          </button>
        ))}
        {tab === 'application' && (
          <select
            className="ml-2 rounded-lg border border-white/10 bg-surface-900 px-3 py-1.5 text-xs text-slate-200"
            value={selectedAppsvn}
            onChange={(e) => onPickAppsvn(e.target.value)}
          >
            {!apps.length && <option value="">No APPSVN tagged repos</option>}
            {apps.map((a) => (
              <option key={a.appsvn} value={a.appsvn}>
                {a.appsvn} — {a.label} ({a.repo_count} repos)
              </option>
            ))}
          </select>
        )}
        {tab === 'patterns' && (
          <select
            className="ml-2 rounded-lg border border-white/10 bg-surface-900 px-3 py-1.5 text-xs text-slate-200"
            value={selectedFamily}
            onChange={(e) => onPickFamily(e.target.value)}
          >
            <option value="">All resource families</option>
            {families.map((f) => (
              <option key={f.id} value={f.id}>
                {f.id} — {f.label || f.id}
                {f.resource_count != null ? ` (${f.resource_count})` : ''}
              </option>
            ))}
          </select>
        )}
      </div>

      <p className="mb-4 max-w-3xl text-xs leading-relaxed text-slate-400">
        {tab === 'patterns'
          ? 'Architect / auditor workbench: pick a technical resource family, inspect simple vs complex implementations, stamp a Layer-1 pattern to inherit compliance coverage across APPSVN apps on that pattern.'
          : 'Select an APPSVN to see only the infra graph for that application (repos/stacks/resources linked to the tag). Use Blast Radius for module impact drills.'}
      </p>

      <div className="mb-4 flex flex-wrap gap-2">
        <span className="badge-info">{data?.counts?.repositories ?? 0} repos</span>
        <span className="badge-neutral">{data?.counts?.graph_nodes ?? 0} nodes</span>
        <span className="badge-neutral">{data?.counts?.graph_edges ?? 0} edges</span>
        {tab === 'patterns' && (
          <>
            <span className="badge-neutral">{data?.counts?.catalog_observed ?? visibleCatalog.filter((p) => p.observed).length} patterns observed</span>
            <span className="badge-neutral">{data?.counts?.catalog_stamped ?? visibleCatalog.filter((p) => p.stamped).length} stamped</span>
            <span className="badge-neutral">{data?.counts?.resource_types ?? 0} resource types</span>
          </>
        )}
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

      {tab === 'patterns' && (
        <div className="mb-6">
          <SectionTitle>Pattern catalog</SectionTitle>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {visibleCatalog.map((p) => {
              const active = p.pattern_id === selectedPatternId;
              return (
                <button
                  key={p.pattern_id}
                  type="button"
                  onClick={() => onPickPattern(p.pattern_id)}
                  className={`rounded-lg border px-3 py-3 text-left transition ${
                    active
                      ? 'border-brand-500/50 bg-brand-500/10 ring-1 ring-brand-500/30'
                      : 'border-white/10 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.05]'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="font-mono text-[11px] text-brand-300">{p.pattern_id}</div>
                    <div className="flex flex-wrap gap-1">
                      <span className={`badge-${p.tier === 'complex' ? 'warning' : 'neutral'} text-[10px]`}>
                        {p.tier}
                      </span>
                      {p.stamped && (
                        <span className="badge-success inline-flex items-center gap-0.5 text-[10px]">
                          <ShieldCheck className="h-3 w-3" />
                          stamped
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="mt-1 text-xs font-medium text-slate-200">{p.display_name}</div>
                  <div className="mt-2 line-clamp-2 text-[10px] leading-relaxed text-slate-500">
                    {p.architect_summary}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5 text-[10px]">
                    <span className="badge-info">{p.family}</span>
                    <span className="badge-neutral">{p.instance_count || 0} instances</span>
                    <span className="badge-neutral">covers {p.covered_app_count || 0} apps</span>
                    {!p.observed && <span className="badge-neutral">not observed</span>}
                  </div>
                </button>
              );
            })}
            {!visibleCatalog.length && !loading && (
              <p className="text-xs text-slate-500">No patterns in catalog for this family.</p>
            )}
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          {showingArchitecture && architecture && (
            <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3 print:border-slate-300 print:bg-white">
              <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-slate-500">
                    Auditor architecture package
                  </div>
                  <div className="font-mono text-xs text-brand-300">{architecture.pattern_id}</div>
                  <div className="text-sm font-medium text-slate-100">{architecture.display_name}</div>
                </div>
                <div className="flex flex-wrap gap-1.5 text-[10px]">
                  <span className={`badge-${architecture.tier === 'complex' ? 'warning' : 'neutral'}`}>
                    {architecture.tier}
                  </span>
                  <span className="badge-info">{architecture.family}</span>
                  <span className={`badge-${architecture.stamped ? 'success' : 'neutral'}`}>
                    {architecture.stamped ? 'stamped' : 'unstamped'}
                  </span>
                  <span className="badge-neutral">{architecture.instance_count || 0} instances</span>
                  <span className="badge-neutral">
                    {(architecture.covered_apps || []).length} apps covered
                  </span>
                </div>
              </div>
              {(architecture.flow_summary || []).length > 0 && (
                <ul className="mb-2 space-y-0.5 border-t border-white/5 pt-2 text-[11px] leading-relaxed text-slate-400">
                  {architecture.flow_summary.map((line, i) => (
                    <li key={i}>· {line}</li>
                  ))}
                </ul>
              )}
              {(architecture.topology_facts || []).length > 0 && (
                <div className="mb-1 flex flex-wrap gap-1">
                  {architecture.topology_facts.slice(0, 8).map((f) => (
                    <span key={f} className="badge-neutral text-[10px]">
                      {f}
                    </span>
                  ))}
                </div>
              )}
              <div className="mt-1 flex flex-wrap gap-1 text-[10px] text-slate-500">
                {architecture.sources?.postgres && <span className="badge-info">postgres</span>}
                {architecture.sources?.neo4j && <span className="badge-info">neo4j</span>}
                {architecture.sources?.seed && <span className="badge-neutral">seed fill</span>}
              </div>
            </div>
          )}

          <div>
            <SectionTitle>
              {tab === 'application'
                ? `Application graph${data?.appsvn ? ` · ${data.appsvn}` : ''}`
                : showingArchitecture
                  ? `Architecture diagram · ${selectedPatternId}`
                  : selectedPatternId
                    ? `Pattern graph · ${selectedPatternId}`
                    : selectedFamily
                      ? `Technical graph · ${selectedFamily}`
                      : 'Technical pattern graph'}
            </SectionTitle>
            <div className="card">
              <div className="card-body">
                {loading || (selectedPatternId && archLoading) ? (
                  <div className="flex h-[520px] items-center justify-center text-sm text-slate-500">
                    Loading {showingArchitecture || selectedPatternId ? 'architecture' : tab === 'application' ? 'application' : 'pattern'}…
                  </div>
                ) : (
                  <DependencyGraph
                    nodes={displayGraph.nodes}
                    edges={displayGraph.edges}
                    selectedNodeId={selectedNodeId}
                    onNodeClick={(n) => setSelectedNodeId((prev) => (prev === n.id ? null : n.id))}
                    slice={showingArchitecture ? 'architecture' : 'lineage'}
                    height={520}
                  />
                )}
                {archError && selectedPatternId && (
                  <p className="mt-2 text-[11px] text-amber-400">{archError}</p>
                )}
              </div>
            </div>
          </div>

          {showingArchitecture && architecture && (
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <SectionTitle>Ingress</SectionTitle>
                <div className="card overflow-x-auto p-0">
                  <table className="w-full text-left text-[11px]">
                    <thead className="border-b border-white/10 text-[10px] uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-3 py-2 font-medium">Port</th>
                        <th className="px-3 py-2 font-medium">Protocol</th>
                        <th className="px-3 py-2 font-medium">Source</th>
                        <th className="px-3 py-2 font-medium">Dest</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(architecture.ingress || []).map((r, i) => (
                        <tr key={`in-${i}`} className="border-b border-white/5 text-slate-300">
                          <td className="px-3 py-1.5 font-mono text-brand-300">{r.port}</td>
                          <td className="px-3 py-1.5 font-mono">{r.protocol}</td>
                          <td className="px-3 py-1.5">{r.source}</td>
                          <td className="px-3 py-1.5 text-slate-400">{r.destination}</td>
                        </tr>
                      ))}
                      {!(architecture.ingress || []).length && (
                        <tr>
                          <td colSpan={4} className="px-3 py-3 text-slate-500">
                            No ingress rules
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
              <div>
                <SectionTitle>Egress</SectionTitle>
                <div className="card overflow-x-auto p-0">
                  <table className="w-full text-left text-[11px]">
                    <thead className="border-b border-white/10 text-[10px] uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-3 py-2 font-medium">Port</th>
                        <th className="px-3 py-2 font-medium">Protocol</th>
                        <th className="px-3 py-2 font-medium">Source</th>
                        <th className="px-3 py-2 font-medium">Dest</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(architecture.egress || []).map((r, i) => (
                        <tr key={`eg-${i}`} className="border-b border-white/5 text-slate-300">
                          <td className="px-3 py-1.5 font-mono text-brand-300">{r.port}</td>
                          <td className="px-3 py-1.5 font-mono">{r.protocol}</td>
                          <td className="px-3 py-1.5">{r.source}</td>
                          <td className="px-3 py-1.5 text-slate-400">{r.destination}</td>
                        </tr>
                      ))}
                      {!(architecture.egress || []).length && (
                        <tr>
                          <td colSpan={4} className="px-3 py-3 text-slate-500">
                            No egress rules
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
              {(architecture.legend || []).length > 0 && (
                <div className="md:col-span-2">
                  <SectionTitle>Legend</SectionTitle>
                  <div className="card flex flex-wrap gap-2 p-3 text-[10px] text-slate-400">
                    {architecture.legend.map((l) => (
                      <span key={l.id} className="rounded border border-white/10 px-2 py-1">
                        <span className="font-mono text-slate-200">{l.label}</span>
                        <span className="ml-1.5">{l.meaning}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="space-y-6">
          {tab === 'patterns' && selectedPattern && (
            <div>
              <SectionTitle>Pattern detail</SectionTitle>
              <div className="card space-y-3 p-3">
                <div className="font-mono text-[11px] text-brand-300">{selectedPattern.pattern_id}</div>
                <div className="text-xs text-slate-200">{selectedPattern.display_name}</div>
                <div className="rounded border border-white/5 bg-black/20 p-2 text-[10px] leading-relaxed text-slate-400">
                  <div className="mb-1 text-[10px] uppercase tracking-wide text-slate-500">Audit</div>
                  {selectedPattern.audit_statement}
                </div>
                <div className="rounded border border-white/5 bg-black/20 p-2 text-[10px] leading-relaxed text-slate-400">
                  <div className="mb-1 text-[10px] uppercase tracking-wide text-slate-500">FinOps</div>
                  {selectedPattern.finops_notes}
                </div>
                <div className="flex flex-wrap gap-1.5 text-[10px]">
                  <span className={`badge-${selectedPattern.tier === 'complex' ? 'warning' : 'neutral'}`}>
                    {selectedPattern.tier}
                  </span>
                  <span className="badge-info">{selectedPattern.family}</span>
                  <span className="badge-neutral">{selectedPattern.instance_count} instances</span>
                </div>
                {(selectedPattern.detection_signals || []).length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {selectedPattern.detection_signals.map((s) => (
                      <span key={s} className="badge-info text-[10px]">
                        {s}
                      </span>
                    ))}
                  </div>
                )}

                <div>
                  <div className="mb-1.5 text-[10px] uppercase tracking-wide text-slate-500">
                    Covered apps (inherited on stamp)
                  </div>
                  {(selectedPattern.covered_apps || []).length ? (
                    selectedPattern.covered_apps.map((a) => (
                      <div
                        key={a.appsvn}
                        className="mb-1 flex items-center justify-between rounded border border-white/5 px-2 py-1 text-[11px]"
                      >
                        <span>
                          <span className="font-mono text-brand-300">{a.appsvn}</span>
                          <span className="ml-1.5 text-slate-500">{a.label}</span>
                        </span>
                        <span className="text-[10px] text-slate-500">
                          {a.inherited ? 'inherited' : 'direct'} · {a.repo_ids?.length || 0} repos
                        </span>
                      </div>
                    ))
                  ) : (
                    <p className="text-[11px] text-slate-500">
                      No APPSVN coverage yet — stamp still records the control; apps appear when consumers use this pattern.
                    </p>
                  )}
                </div>

                {selectedPattern.stamp && (
                  <div className="rounded border border-emerald-500/20 bg-emerald-500/5 px-2 py-2 text-[11px] text-emerald-200">
                    <div className="flex items-center gap-1 font-medium">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Stamped by {selectedPattern.stamp.auditor}
                    </div>
                    <div className="mt-1 text-[10px] text-emerald-200/70">
                      {selectedPattern.stamp.compliance_framework || 'framework n/a'}
                      {selectedPattern.stamp.comment ? ` · ${selectedPattern.stamp.comment}` : ''}
                    </div>
                  </div>
                )}

                <div className="border-t border-white/10 pt-3">
                  <div className="mb-2 text-[10px] uppercase tracking-wide text-slate-500">Stamp / approve</div>
                  <label className="mb-2 block text-[10px] text-slate-500">
                    Auditor
                    <input
                      className="mt-0.5 w-full rounded border border-white/10 bg-surface-900 px-2 py-1.5 text-xs text-slate-200"
                      value={stampForm.auditor}
                      onChange={(e) => setStampForm((f) => ({ ...f, auditor: e.target.value }))}
                    />
                  </label>
                  <label className="mb-2 block text-[10px] text-slate-500">
                    Framework
                    <input
                      className="mt-0.5 w-full rounded border border-white/10 bg-surface-900 px-2 py-1.5 text-xs text-slate-200"
                      value={stampForm.compliance_framework}
                      onChange={(e) => setStampForm((f) => ({ ...f, compliance_framework: e.target.value }))}
                      placeholder="SOC2 / PCI-DSS / ISO27001"
                    />
                  </label>
                  <label className="mb-2 block text-[10px] text-slate-500">
                    Comment
                    <textarea
                      className="mt-0.5 w-full rounded border border-white/10 bg-surface-900 px-2 py-1.5 text-xs text-slate-200"
                      rows={2}
                      value={stampForm.comment}
                      onChange={(e) => setStampForm((f) => ({ ...f, comment: e.target.value }))}
                      placeholder="Evidence note for external audit package"
                    />
                  </label>
                  <button
                    type="button"
                    disabled={stampBusy || !stampForm.auditor.trim()}
                    onClick={onStamp}
                    className="btn-primary w-full text-xs disabled:opacity-50"
                  >
                    {stampBusy ? 'Stamping…' : selectedPattern.stamped ? 'Re-stamp pattern' : 'Stamp pattern'}
                  </button>
                  {stampMsg && <p className="mt-2 text-[10px] text-slate-400">{stampMsg}</p>}
                </div>
              </div>
            </div>
          )}

          {tab === 'patterns' && !selectedPattern && (
            <>
              <div>
                <SectionTitle>Patterns in use</SectionTitle>
                <div className="card max-h-[280px] overflow-y-auto p-3">
                  <div className="mb-2 text-[10px] uppercase tracking-wide text-slate-500">Resource types</div>
                  {(patterns?.resource_types || []).slice(0, 12).map((rt) => (
                    <div key={rt.type} className="mb-1 flex items-center justify-between text-[11px]">
                      <span className="font-mono text-slate-300">{rt.type}</span>
                      <span className="badge-neutral">{rt.count}</span>
                    </div>
                  ))}
                  {!patterns?.resource_types?.length && (
                    <p className="text-xs text-slate-500">No resources scanned yet.</p>
                  )}
                  <div className="mb-2 mt-4 text-[10px] uppercase tracking-wide text-slate-500">Module sources</div>
                  {(patterns?.module_sources || []).slice(0, 8).map((m) => (
                    <div key={`${m.source}:${m.ref}`} className="mb-1.5 rounded border border-white/5 px-2 py-1">
                      <div className="truncate font-mono text-[10px] text-brand-300">{m.source}</div>
                      <div className="mt-0.5 text-[10px] text-slate-500">
                        {m.ref || 'latest'} · {m.consumer_count} consumer{m.consumer_count === 1 ? '' : 's'}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <SectionTitle>Subscribed inventory</SectionTitle>
                <div className="card max-h-[240px] overflow-y-auto p-3">
                  {(data?.subscribed_repos || []).map((r) => (
                    <div key={r.id} className="mb-2 rounded-lg border border-white/10 px-3 py-2">
                      <div className="font-mono text-[11px] text-brand-300">{r.name || r.id}</div>
                      <div className="mt-1 flex flex-wrap gap-1.5 text-[10px]">
                        <span className={`badge-${r.role === 'module_source' ? 'info' : 'neutral'}`}>
                          {String(r.role).replace(/_/g, ' ')}
                        </span>
                        <span className="badge-neutral">{r.resource_count} resources</span>
                        {r.appsvn && <span className="badge-info">{r.appsvn}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {tab === 'application' && (
            <div>
              <SectionTitle>Application repos</SectionTitle>
              <div className="card max-h-[560px] overflow-y-auto p-3">
                {(data?.repos || []).map((r) => (
                  <div key={r.id} className="mb-2 rounded-lg border border-white/10 px-3 py-2">
                    <div className="font-mono text-[11px] text-brand-300">{r.name || r.id}</div>
                    <div className="mt-1 flex flex-wrap gap-1.5 text-[10px]">
                      <span className="badge-info">{r.appsvn}</span>
                      <span className="badge-neutral">{r.resource_count} resources</span>
                    </div>
                    <button
                      type="button"
                      className="mt-2 text-[10px] text-brand-400 hover:text-brand-300"
                      onClick={() => navigate(blastPathForRepo(r.id))}
                    >
                      Open blast radius →
                    </button>
                  </div>
                ))}
                {!data?.repos?.length && !loading && (
                  <p className="text-xs text-slate-500">
                    No repos for this APPSVN. Sync subscriptions and ensure sample consumers are tagged.
                  </p>
                )}
                <div className="mt-4 border-t border-white/10 pt-3">
                  <div className="mb-2 text-[10px] uppercase tracking-wide text-slate-500">All applications</div>
                  {apps.map((a) => (
                    <button
                      key={a.appsvn}
                      type="button"
                      onClick={() => onPickAppsvn(a.appsvn)}
                      className={`mb-1.5 flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-[11px] transition ${
                        a.appsvn === selectedAppsvn
                          ? 'bg-brand-500/15 text-brand-200 ring-1 ring-brand-500/30'
                          : 'text-slate-400 hover:bg-white/5'
                      }`}
                    >
                      <span>
                        <span className="font-mono">{a.appsvn}</span>
                        <span className="ml-1.5 text-slate-500">{a.label}</span>
                      </span>
                      <span className="text-slate-500">{a.repo_count}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </PageShell>
  );
}

function blastPathForRepo(repoId) {
  if (String(repoId).includes('storage')) return '/impact/modules-storage';
  if (String(repoId).includes('database') || String(repoId).includes('rds')) return '/impact/modules-rds';
  return `/impact/${DEFAULT_MODULE_SLUG}`;
}
