import { useState } from 'react';
import { Link } from 'react-router-dom';
import Header from '../components/Header';
import { PageShell } from '../components/ui';
import { releaseTag } from '../data/mockData';
import { api } from '../api/client';
import { useApiData } from '../api/useApiData';

export default function ReleaseTagPage() {
  const { data: plans } = useApiData(api.rolloutPlans, []);
  const [triggering, setTriggering] = useState(false);

  async function triggerImpact() {
    setTriggering(true);
    try {
      await api.triggerImpact({
        upstream_repo_id: 'upstream-core-network-modules',
        from_version: 'v2.4.2',
        to_version: 'v3.0.0',
      });
      window.location.reload();
    } finally {
      setTriggering(false);
    }
  }

  const rows = (plans || []).length ? plans : [
    ['acme/infra-payments-prod', 'Canary', 'prod', 'critical'],
    ['acme/infra-checkout-stg', 'Rolling', 'staging', 'medium'],
  ].map(([repo, strategy, env, risk]) => ({ downstream_repo: repo, strategy, env, risk }));

  return (
    <PageShell
      header={
        <Header
          title="Release Tag Impact"
          subtitle="Mandatory analysis triggered on tag merge — P0 job queue"
          actions={
            <button type="button" className="btn-primary" onClick={triggerImpact} disabled={triggering}>
              {triggering ? 'Enqueueing…' : 'Trigger P0 Impact Analysis'}
            </button>
          }
        />
      }
    >
      <div className="card mb-6">
        <div className="card-body grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <div>
            <div className="text-xs text-slate-500">Repository</div>
            <div className="font-mono text-sm text-brand-400">{releaseTag.repo}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Version</div>
            <div className="font-mono text-sm">{releaseTag.fromVersion} → {releaseTag.toVersion}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Downstream plans</div>
            <div className="text-sm">{rows.length}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Analysis</div>
            <span className="badge-success">{releaseTag.analysisStatus}</span>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header flex justify-between">
          <h3 className="font-semibold">Downstream rollout plans ({rows.length})</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 text-left text-xs text-slate-500">
                <th className="px-5 py-3">Downstream repo</th>
                <th className="px-5 py-3">Strategy</th>
                <th className="px-5 py-3">Version gap</th>
                <th className="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.downstream_repo || row.id} className="table-row">
                  <td className="px-5 py-3 font-mono text-xs">{row.downstream_repo}</td>
                  <td className="px-5 py-3">{row.strategy}</td>
                  <td className="px-5 py-3">{row.version_gap || '—'}</td>
                  <td className="px-5 py-3">
                    <Link to="/plans/rollout" className="text-xs text-brand-400 hover:underline">View plan →</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </PageShell>
  );
}
