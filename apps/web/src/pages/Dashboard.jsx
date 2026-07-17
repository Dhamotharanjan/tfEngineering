import { Link } from 'react-router-dom';
import { ArrowRight, AlertTriangle, CheckCircle2, Wifi, WifiOff } from 'lucide-react';
import Header from '../components/Header';
import { MetricCard, PageShell, SectionTitle } from '../components/ui';
import { dashboardStats, releaseTag, observability, eolItems } from '../data/mockData';
import { api } from '../api/client';
import { useApiData } from '../api/useApiData';

export default function Dashboard() {
  const { data: stats, live } = useApiData(api.dashboardStats, dashboardStats);
  const { data: eol } = useApiData(api.eol, eolItems);

  return (
    <PageShell
      header={
        <Header
          title="Executive Dashboard"
          subtitle={`Infrastructure change intelligence${live ? ' · live API' : ' · mock fallback'}`}
          actions={
            <span className={`badge-${live ? 'success' : 'neutral'} flex items-center gap-1`}>
              {live ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
              {live ? 'Live' : 'Mock'}
            </span>
          }
        />
      }
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Subscribed Repos" value={stats?.subscribedRepos ?? stats?.subscribedRepos ?? 0} sub="from PostgreSQL subscriptions" />
        <MetricCard label="Affected Monthly Spend" value={`$${((stats?.monthlySpend || 0) / 1000).toFixed(1)}K`} sub="modules/vpc blast radius" variant="warning" />
        <MetricCard label="Extended Support Tax" value={`$${stats?.extendedSupportCost || 0}/mo`} sub="EOL registry" variant="critical" />
        <MetricCard label="Open Plans" value={stats?.openPlans || 0} sub={`${stats?.pendingJobs || 0} pending jobs`} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className="card">
          <div className="card-header flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-white">Latest Release Tag Analysis</h3>
              <p className="text-xs text-slate-500">Mandatory impact analysis — P0 queue</p>
            </div>
            <span className="badge-success flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3" /> Ready
            </span>
          </div>
          <div className="card-body space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-slate-400">Module</span>
              <span className="font-mono text-brand-400">{releaseTag.module} {releaseTag.toVersion}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-400">Downstream impact</span>
              <span>{releaseTag.impact.stacks} stacks · {releaseTag.impact.teams} teams</span>
            </div>
            <Link to="/releases/v3.0.0" className="btn-primary mt-2 w-full">
              View Release Impact <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h3 className="font-semibold text-white">Requires Attention</h3>
          </div>
          <div className="card-body space-y-3">
            {(eol || []).slice(0, 3).map((item) => (
              <div key={item.resource || item.repo} className="flex items-start gap-3 rounded-lg bg-white/5 p-3">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-white">{item.resource || item.repo}</div>
                  <div className="text-xs text-slate-400">{item.risk}</div>
                </div>
              </div>
            ))}
            <Link to="/eol" className="btn-secondary w-full text-center">View all EOL risks</Link>
          </div>
        </div>
      </div>

      <SectionTitle>Platform Observability</SectionTitle>
      <div className="grid gap-4 md:grid-cols-3">
        <div className="card p-4">
          <div className="stat-label">Patch cycles due</div>
          <div className="stat-value mt-1">{observability.patchCycles.filter((p) => p.status !== 'ok').length}</div>
        </div>
        <div className="card p-4">
          <div className="stat-label">Security patches open</div>
          <div className="stat-value mt-1">{observability.securityPatches.length}</div>
        </div>
        <div className="card p-4">
          <div className="stat-label">DR tests in progress</div>
          <div className="stat-value mt-1">{observability.drTests.filter((d) => d.status === 'in_progress').length}</div>
        </div>
      </div>
    </PageShell>
  );
}
