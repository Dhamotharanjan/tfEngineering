import Header from '../components/Header';
import { PageShell } from '../components/ui';
import { rolloutPlan as mockPlan } from '../data/mockData';
import { api } from '../api/client';
import { useApiData } from '../api/useApiData';

export default function RolloutPlanPage() {
  const { data: plan, live } = useApiData(api.rolloutPlan, mockPlan);

  return (
    <PageShell
      header={
        <Header
          title="Rollout Plan"
          subtitle={`${plan?.downstreamRepo || mockPlan.downstreamRepo} — ${live ? 'live API' : 'mock'}`}
        />
      }
    >
      <div className="mb-6 flex flex-wrap gap-2">
        <span className="badge-success text-sm">Strategy: {plan?.strategy || mockPlan.strategy}</span>
        <span className="badge-neutral">{plan?.strategyReason || mockPlan.strategyReason}</span>
      </div>

      <div className="card">
        <div className="card-header">
          <h3 className="font-semibold">Execution steps</h3>
        </div>
        <div className="card-body">
          <ol className="space-y-4">
            {(plan?.phases || mockPlan.phases).map((p) => (
              <li key={p.step} className="flex gap-4">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-500/20 text-sm font-bold text-brand-400">
                  {p.step}
                </div>
                <div className="flex-1 border-b border-white/5 pb-4">
                  <div className="text-sm text-white">{p.action}</div>
                  <div className="mt-1 text-xs text-slate-500">Est. duration: {p.duration}</div>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>

      <div className="mt-6 card card-body">
        <h4 className="text-sm font-semibold text-white">Rollback procedure</h4>
        <p className="mt-2 text-sm text-slate-300">{plan?.rollback || mockPlan.rollback}</p>
      </div>
    </PageShell>
  );
}
