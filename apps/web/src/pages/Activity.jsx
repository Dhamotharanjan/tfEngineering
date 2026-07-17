import Header from '../components/Header';
import { PageShell } from '../components/ui';
import { api } from '../api/client';
import { useApiData } from '../api/useApiData';

const fallbackJobs = [
  { id: 'job-8842', type: 'mandatory_impact_analysis', target: 'release v3.0.0', status: 'completed', priority: 'P0' },
];

export default function Activity() {
  const { data: jobs, live, loading } = useApiData(api.jobs, fallbackJobs);

  return (
    <PageShell
      header={
        <Header
          title="Scan Activity"
          subtitle={`Redis queue · PostgreSQL scan_jobs${live ? ' (live)' : ''}`}
        />
      }
    >
      {loading && <p className="mb-4 text-sm text-slate-500">Loading jobs…</p>}
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10 text-left text-xs text-slate-500">
              <th className="px-5 py-3">Job ID</th>
              <th className="px-5 py-3">Type</th>
              <th className="px-5 py-3">Target</th>
              <th className="px-5 py-3">Priority</th>
              <th className="px-5 py-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {(jobs || []).map((j) => (
              <tr key={j.id} className="table-row">
                <td className="px-5 py-3 font-mono text-xs">{j.id}</td>
                <td className="px-5 py-3">{j.type || j.job_type}</td>
                <td className="px-5 py-3">{j.target || j.repo_id}</td>
                <td className="px-5 py-3"><span className={j.priority === 'P0' ? 'badge-critical' : 'badge-neutral'}>{j.priority}</span></td>
                <td className="px-5 py-3"><span className={j.status === 'running' ? 'badge-warning' : 'badge-success'}>{j.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </PageShell>
  );
}
