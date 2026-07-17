import Header from '../components/Header';
import { PageShell, SectionTitle } from '../components/ui';
import { observability } from '../data/mockData';

export default function ObservabilityPage() {
  return (
    <PageShell
      header={
        <Header
          title="Platform Observability"
          subtitle="registry platform_observability — patch cycles, security patches, DR testing"
        />
      }
    >
      <SectionTitle>Patch cycles (recommended)</SectionTitle>
      <div className="card mb-8 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10 text-left text-xs text-slate-500">
              <th className="px-5 py-3">Resource</th>
              <th className="px-5 py-3">Current</th>
              <th className="px-5 py-3">Recommended</th>
              <th className="px-5 py-3">Window</th>
              <th className="px-5 py-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {observability.patchCycles.map((p) => (
              <tr key={p.resource} className="table-row">
                <td className="px-5 py-3 font-medium text-white">{p.resource}</td>
                <td className="px-5 py-3 font-mono text-xs">{p.current}</td>
                <td className="px-5 py-3 font-mono text-xs text-brand-400">{p.recommended}</td>
                <td className="px-5 py-3">{p.window}</td>
                <td className="px-5 py-3">
                  <span className={p.status === 'urgent' ? 'badge-critical' : p.status === 'scheduled' ? 'badge-warning' : 'badge-success'}>
                    {p.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <SectionTitle>Security patch backlog</SectionTitle>
      <div className="card mb-8 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10 text-left text-xs text-slate-500">
              <th className="px-5 py-3">ID</th>
              <th className="px-5 py-3">CVE</th>
              <th className="px-5 py-3">Affected</th>
              <th className="px-5 py-3">Downstream repos</th>
              <th className="px-5 py-3">Severity</th>
            </tr>
          </thead>
          <tbody>
            {observability.securityPatches.map((s) => (
              <tr key={s.id} className="table-row">
                <td className="px-5 py-3 font-mono text-xs">{s.id}</td>
                <td className="px-5 py-3">{s.cve}</td>
                <td className="px-5 py-3">{s.affected}</td>
                <td className="px-5 py-3">{s.downstreamRepos}</td>
                <td className="px-5 py-3"><span className="badge-critical">{s.severity}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <SectionTitle>DR testing</SectionTitle>
      <div className="space-y-4">
        {observability.drTests.map((dr) => (
          <div key={dr.id} className="card p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h4 className="font-semibold text-white">{dr.name}</h4>
                <p className="text-xs text-slate-500">{dr.id}</p>
              </div>
              <span className={dr.status === 'in_progress' ? 'badge-warning' : 'badge-success'}>{dr.status}</span>
            </div>
            {dr.decommissionScheduled && (
              <p className="mt-2 text-sm text-amber-300">Decommission scheduled: {dr.decommissionScheduled}</p>
            )}
            {dr.rtoActual && (
              <p className="mt-1 text-xs text-slate-400">RTO target {dr.rtoTarget} · actual {dr.rtoActual}</p>
            )}
          </div>
        ))}
      </div>
    </PageShell>
  );
}
