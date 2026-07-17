import { Fragment, useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronRight, ExternalLink, RefreshCw } from 'lucide-react';
import Header from '../components/Header';
import { PageShell } from '../components/ui';
import { api } from '../api/client';
import { useApiData } from '../api/useApiData';
import { blastRadiusPathForRepo, moduleSlugForRepo } from '../config/blastRadiusModules';

const MOCK_REPOS = [
  { id: 'upstream-core-network-modules', name: 'acme/terraform-modules-vpc', role: 'module_source', tier: 'enterprise', stacks: 12, resource_count: 8, lastScan: '—', last_scan_status: 'completed', subscribed: true },
  { id: 'team-database-platform-infra', name: 'acme/infra-payments-prod', role: 'downstream_consumer', tier: 'professional', stacks: 8, resource_count: 0, lastScan: '—', last_scan_status: 'completed', subscribed: true },
  { id: 'repo-a', name: 'acme/infra-checkout-stg', role: 'downstream_consumer', tier: 'standard', stacks: 4, resource_count: 4, lastScan: '—', last_scan_status: 'completed', subscribed: true },
];

const MOCK_REPO_DETAILS = {
  resources: { resources: [{ id: 'aws_vpc.main' }, { id: 'aws_subnet.a' }, { id: 'aws_security_group.web' }] },
  upstreamLayers: { count: 2, layers: [{ layer: 1 }, { layer: 2 }] },
};

function scanBadge(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'completed') return <span className="badge-success">completed</span>;
  if (s === 'failed' || s === 'error') return <span className="badge-critical">failed</span>;
  if (s === 'queued' || s === 'pending' || s === 'running' || s === 'in_progress') {
    return <span className="badge-warning">{s || 'queued'}</span>;
  }
  return <span className="badge-neutral">{status || 'never'}</span>;
}

function RepoExpandPanel({ repoId, details, loading }) {
  if (loading) {
    return (
      <td colSpan={9} className="bg-white/[0.02] px-5 py-4 text-xs text-slate-500">
        Loading resources and upstream layers…
      </td>
    );
  }

  const resourceCount = details?.resources?.resources?.length ?? details?.resources?.count ?? 0;
  const layerCount = details?.upstreamLayers?.count ?? details?.upstreamLayers?.layers?.length ?? 0;
  const live = details?.live;
  const byType = {};
  for (const r of details?.resources?.resources || []) {
    byType[r.type] = (byType[r.type] || 0) + 1;
  }

  return (
    <td colSpan={9} className="bg-white/[0.02] px-5 py-4">
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <span className="badge-info">{resourceCount} cloud resources{!live ? ' · mock' : ''}</span>
        <span className="badge-warning">{layerCount} upstream layer{layerCount === 1 ? '' : 's'}{!live ? ' · mock' : ''}</span>
        <Link
          to={blastRadiusPathForRepo(repoId, { slice: 'lineage' })}
          className="inline-flex items-center gap-1 text-xs text-brand-400 hover:underline"
        >
          Org lineage blast radius <ExternalLink className="h-3 w-3" />
        </Link>
        <Link
          to={`/impact/${moduleSlugForRepo(repoId)}?repoId=${encodeURIComponent(repoId)}&slice=component`}
          className="inline-flex items-center gap-1 text-xs text-slate-400 hover:underline"
        >
          Resources only
        </Link>
      </div>
      {Object.keys(byType).length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {Object.entries(byType).map(([type, n]) => (
            <span key={type} className="badge-neutral font-mono text-[10px]">{type} ×{n}</span>
          ))}
        </div>
      )}
      {details?.resources?.resources?.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {details.resources.resources.slice(0, 8).map((r) => (
            <span key={r.id} className="badge-neutral font-mono text-[10px]">{r.id}</span>
          ))}
          {details.resources.resources.length > 8 && (
            <span className="text-xs text-slate-500">+{details.resources.resources.length - 8} more</span>
          )}
        </div>
      )}
    </td>
  );
}

export default function Repos() {
  const { data, live, loading, reload } = useApiData(api.subscriptions, MOCK_REPOS);
  const [syncing, setSyncing] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [repoDetails, setRepoDetails] = useState({});
  const [detailsLoading, setDetailsLoading] = useState(null);
  const [message, setMessage] = useState(null);

  const rows = (data || []).map((r) => ({
    id: r.id,
    name: r.name || r.github_full_name,
    role: r.role,
    tier: r.tier || r.entitlement_tier || 'Standard',
    stacks: r.stacks ?? r.graph_node_count ?? 0,
    resource_count: r.resource_count ?? 0,
    lastScan: r.lastScan || r.last_scan_at || '—',
    last_scan_status: r.last_scan_status,
    subscribed: r.subscribed !== false,
  }));

  const subscribedCount = rows.filter((r) => r.subscribed).length;

  async function handleSync() {
    setSyncing(true);
    setMessage(null);
    try {
      const res = await api.syncSubscriptions();
      setMessage(`Synced ${res.synced} repos from config${res.org_id ? ` · org ${res.org_id}` : ''}`);
      await reload?.();
    } catch (e) {
      setMessage(e.message || 'Sync failed');
    } finally {
      setSyncing(false);
    }
  }

  const toggleSubscribe = useCallback(async (repo) => {
    setBusyId(repo.id);
    setMessage(null);
    try {
      const next = !repo.subscribed;
      const res = await api.updateSubscription(repo.id, { subscribed: next });
      setMessage(res.message + (res.job ? ' · scan queued' : ''));
      await reload?.();
    } catch (e) {
      setMessage(e.message || 'Update failed');
    } finally {
      setBusyId(null);
    }
  }, [reload]);

  async function handleScan(repoId) {
    setBusyId(repoId);
    setMessage(null);
    try {
      await api.triggerScan(repoId);
      setMessage(`Scan queued for ${repoId}`);
      await reload?.();
    } catch (e) {
      setMessage(e.message || 'Scan failed');
    } finally {
      setBusyId(null);
    }
  }

  async function toggleExpand(repoId) {
    if (expanded === repoId) {
      setExpanded(null);
      return;
    }
    setExpanded(repoId);
    if (repoDetails[repoId]) return;

    setDetailsLoading(repoId);
    try {
      const [resources, upstreamLayers] = await Promise.all([
        api.repoResources(repoId),
        api.repoUpstreamLayers(repoId),
      ]);
      setRepoDetails((prev) => ({
        ...prev,
        [repoId]: { resources, upstreamLayers, live: true },
      }));
    } catch {
      setRepoDetails((prev) => ({
        ...prev,
        [repoId]: {
          resources: MOCK_REPO_DETAILS.resources,
          upstreamLayers: MOCK_REPO_DETAILS.upstreamLayers,
          live: false,
        },
      }));
    } finally {
      setDetailsLoading(null);
    }
  }

  return (
    <PageShell
      header={
        <Header
          title="Repo Subscriptions"
          subtitle={`Org knowledge graph seed · ${subscribedCount}/${rows.length} subscribed${live ? ' · live' : ' · mock'}`}
          actions={
            <div className="flex items-center gap-2">
              <Link to="/graph/org" className="btn-secondary text-xs">
                Org graph
              </Link>
              <button type="button" className="btn-primary" onClick={handleSync} disabled={syncing}>
                {syncing ? 'Syncing…' : 'Sync from config'}
              </button>
            </div>
          }
        />
      }
    >
      {loading && <p className="mb-4 text-sm text-slate-500">Loading subscriptions…</p>}
      {message && <p className="mb-4 text-xs text-brand-300">{message}</p>}

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <div className="card p-3">
          <div className="text-[10px] uppercase tracking-wider text-slate-500">Subscribed</div>
          <div className="mt-1 text-xl font-semibold text-white">{subscribedCount}</div>
        </div>
        <div className="card p-3">
          <div className="text-[10px] uppercase tracking-wider text-slate-500">Cloud resources</div>
          <div className="mt-1 text-xl font-semibold text-white">
            {rows.reduce((n, r) => n + (r.resource_count || 0), 0)}
          </div>
        </div>
        <div className="card p-3">
          <div className="text-[10px] uppercase tracking-wider text-slate-500">Module sources</div>
          <div className="mt-1 text-xl font-semibold text-white">
            {rows.filter((r) => r.role === 'module_source' && r.subscribed).length}
          </div>
        </div>
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10 bg-white/[0.02] text-left text-xs text-slate-500">
              <th className="w-8 px-3 py-3" />
              <th className="px-5 py-3">Repository</th>
              <th className="px-5 py-3">Role</th>
              <th className="px-5 py-3">Tier</th>
              <th className="px-5 py-3">Resources</th>
              <th className="px-5 py-3">Last scan</th>
              <th className="px-5 py-3">Scan status</th>
              <th className="px-5 py-3">Subscription</th>
              <th className="px-5 py-3" />
            </tr>
          </thead>
          <tbody>
            {rows.map((repo) => (
              <Fragment key={repo.id}>
                <tr className="table-row">
                  <td className="px-3 py-3">
                    <button
                      type="button"
                      className="text-slate-400 hover:text-white"
                      onClick={() => toggleExpand(repo.id)}
                      aria-label={expanded === repo.id ? 'Collapse' : 'Expand'}
                    >
                      {expanded === repo.id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </button>
                  </td>
                  <td className="px-5 py-3 font-mono text-xs text-brand-300">{repo.name}</td>
                  <td className="px-5 py-3">
                    <span className={`badge-${repo.role === 'module_source' ? 'info' : 'neutral'}`}>
                      {String(repo.role).replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td className="px-5 py-3">{repo.tier}</td>
                  <td className="px-5 py-3">{repo.resource_count}</td>
                  <td className="px-5 py-3 text-slate-500">{repo.lastScan}</td>
                  <td className="px-5 py-3">{scanBadge(repo.last_scan_status)}</td>
                  <td className="px-5 py-3">
                    <button
                      type="button"
                      className="text-xs"
                      disabled={busyId === repo.id}
                      onClick={() => toggleSubscribe(repo)}
                    >
                      {repo.subscribed ? (
                        <span className="badge-success">Subscribed · click to off</span>
                      ) : (
                        <span className="badge-neutral">Off · click to subscribe</span>
                      )}
                    </button>
                  </td>
                  <td className="px-5 py-3">
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 text-xs text-brand-400 hover:underline disabled:opacity-50"
                      disabled={busyId === repo.id || !repo.subscribed}
                      onClick={() => handleScan(repo.id)}
                    >
                      <RefreshCw className="h-3 w-3" />
                      Scan
                    </button>
                  </td>
                </tr>
                {expanded === repo.id && (
                  <tr className="border-b border-white/5">
                    <RepoExpandPanel
                      repoId={repo.id}
                      details={repoDetails[repo.id]}
                      loading={detailsLoading === repo.id}
                    />
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-4 text-[11px] leading-relaxed text-slate-500">
        Subscriptions decide which repos enter the <strong className="text-slate-300">org knowledge graph</strong>.
        Sync loads <code className="text-slate-400">config/repo-subscriptions.json</code>; toggle updates Postgres
        (and config when writable). Only subscribed repos are scanned by the worker.
      </p>
    </PageShell>
  );
}
