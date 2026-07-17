import { Link } from 'react-router-dom';
import { Download } from 'lucide-react';
import Header from '../components/Header';
import { PageShell } from '../components/ui';
import { changePlan as mockPlan } from '../data/mockData';
import { api } from '../api/client';
import { useApiData } from '../api/useApiData';

const riskBadge = { low: 'badge-success', medium: 'badge-warning', critical: 'badge-critical' };

export default function ChangePlanPage() {
  const { data: plan, live } = useApiData(api.changePlan, mockPlan);

  return (
    <PageShell
      header={
        <Header
          title="Guided Change Plan"
          subtitle={plan?.title || mockPlan.title}
          actions={<Link to="/reports" className="btn-primary"><Download className="h-4 w-4" /> Export CAB Pack</Link>}
        />
      }
    >
      <div className="mb-4 flex gap-2">
        <span className="badge-warning">Status: {(plan?.status || 'pending_approval').replace('_', ' ')}</span>
        <span className="badge-info">{live ? 'PostgreSQL change_plans' : 'mock data'}</span>
      </div>

      <div className="space-y-4">
        {(plan?.phases || mockPlan.phases).map((phase) => (
          <div key={phase.phase} className="card">
            <div className="card-header flex items-center justify-between">
              <div>
                <span className="text-xs font-bold text-brand-400">PHASE {phase.phase}</span>
                <h3 className="font-semibold text-white">{phase.name} — {phase.days}</h3>
              </div>
              <span className={riskBadge[phase.risk] || 'badge-neutral'}>{phase.risk} risk</span>
            </div>
            <div className="card-body">
              {phase.stacks && (
                <ul className="space-y-1 text-sm text-slate-300">
                  {phase.stacks.map((s) => <li key={s} className="font-mono">• {s}</li>)}
                </ul>
              )}
              {phase.gates && phase.gates.map((g) => (
                <div key={g} className="mt-2 text-sm text-amber-300">⚠ {g}</div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6 card card-body text-sm">
        <div><span className="text-slate-500">Rollback:</span> <span className="text-slate-200">{plan?.rollback || mockPlan.rollback}</span></div>
      </div>
    </PageShell>
  );
}
