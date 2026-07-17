import { Link } from 'react-router-dom';
import Header from '../components/Header';
import { PageShell, SectionTitle } from '../components/ui';
import { rdsInstances, lifecycleActions } from '../data/mockData';

export default function RdsLifecycle() {
  return (
    <PageShell
      header={
        <Header
          title="RDS Lifecycle Hub"
          subtitle="Starter registry: all engines — build, rebuild, restore, decommission"
        />
      }
    >
      <SectionTitle>Lifecycle actions</SectionTitle>
      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {lifecycleActions.map((action) => (
          <Link
            key={action.id}
            to={`/lifecycle/rds/wizard?action=${action.id}`}
            className="card p-4 transition hover:ring-1 hover:ring-brand-500/40"
          >
            <h3 className="font-semibold text-white">{action.label}</h3>
            <p className="mt-2 text-xs text-slate-400">{action.description}</p>
            <span className="mt-3 inline-block text-xs text-brand-400">Start wizard →</span>
          </Link>
        ))}
      </div>

      <SectionTitle>Managed RDS instances (Neo4j graph)</SectionTitle>
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10 bg-white/[0.02] text-left text-xs text-slate-500">
              <th className="px-5 py-3">Instance</th>
              <th className="px-5 py-3">Engine</th>
              <th className="px-5 py-3">Account</th>
              <th className="px-5 py-3">KMS</th>
              <th className="px-5 py-3">Cost/mo</th>
              <th className="px-5 py-3">Patches</th>
              <th className="px-5 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {rdsInstances.map((rds) => (
              <tr key={rds.id} className="table-row">
                <td className="px-5 py-3">
                  <div className="font-medium text-white">{rds.name}</div>
                  {rds.drTest && <span className="badge-warning mt-1">DR test · decommission due</span>}
                </td>
                <td className="px-5 py-3 font-mono text-xs">{rds.engine} {rds.version.split('.').slice(0, 2).join('.')}</td>
                <td className="px-5 py-3 text-xs text-slate-400">{rds.account}</td>
                <td className="px-5 py-3 font-mono text-xs text-slate-400">{rds.kmsKey}</td>
                <td className="px-5 py-3">${rds.monthlyCost}</td>
                <td className="px-5 py-3">
                  {rds.patchPending > 0 ? (
                    <span className="badge-warning">{rds.patchPending} pending</span>
                  ) : (
                    <span className="badge-success">Current</span>
                  )}
                </td>
                <td className="px-5 py-3">
                  {rds.drTest ? (
                    <Link to="/lifecycle/rds/wizard?action=decommission" className="text-xs text-red-400 hover:underline">
                      Decommission
                    </Link>
                  ) : (
                    <Link to="/lifecycle/rds/wizard?action=rebuild" className="text-xs text-brand-400 hover:underline">
                      Rebuild
                    </Link>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </PageShell>
  );
}
