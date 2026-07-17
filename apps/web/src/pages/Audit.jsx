import Header from '../components/Header';
import { PageShell } from '../components/ui';
import { auditLog as mockAudit } from '../data/mockData';
import { api } from '../api/client';
import { useApiData } from '../api/useApiData';

export default function Audit() {
  const { data: rows, live } = useApiData(api.audit, mockAudit);

  return (
    <PageShell
      header={
        <Header
          title="Audit Log"
          subtitle={`PostgreSQL audit_log${live ? ' · live' : ' · mock'}`}
        />
      }
    >
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10 text-left text-xs text-slate-500">
              <th className="px-5 py-3">Timestamp</th>
              <th className="px-5 py-3">User</th>
              <th className="px-5 py-3">Action</th>
              <th className="px-5 py-3">Target</th>
            </tr>
          </thead>
          <tbody>
            {(rows || []).map((row, i) => (
              <tr key={i} className="table-row">
                <td className="px-5 py-3 font-mono text-xs text-slate-500">{row.time}</td>
                <td className="px-5 py-3">{row.user}</td>
                <td className="px-5 py-3">{row.action}</td>
                <td className="px-5 py-3 text-brand-300">{row.target}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </PageShell>
  );
}
