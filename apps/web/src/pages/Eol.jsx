import { Link } from 'react-router-dom';
import Header from '../components/Header';
import { MetricCard, PageShell } from '../components/ui';
import { eolItems as mockEol } from '../data/mockData';
import { api } from '../api/client';
import { useApiData } from '../api/useApiData';

export default function EolPage() {
  const { data: items, live } = useApiData(api.eol, mockEol);
  const totalTax = (items || []).reduce((s, i) => s + (i.monthlyCost || 0), 0);

  return (
    <PageShell
      header={
        <Header
          title="EOL & Extended Support"
          subtitle={`Technical debt tax${live ? ' · live' : ' · mock'}`}
        />
      }
    >
      <MetricCard label="Total extended support cost" value={`$${totalTax}/mo`} sub={`${(items || []).length} resources flagged`} variant="critical" />

      <div className="mt-6 card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10 text-left text-xs text-slate-500">
              <th className="px-5 py-3">Repo</th>
              <th className="px-5 py-3">Resource</th>
              <th className="px-5 py-3">Type</th>
              <th className="px-5 py-3">Risk</th>
              <th className="px-5 py-3">Action</th>
            </tr>
          </thead>
          <tbody>
            {(items || []).map((item) => (
              <tr key={item.resource || item.repo} className="table-row">
                <td className="px-5 py-3 font-mono text-xs">{item.repo}</td>
                <td className="px-5 py-3">{item.resource}</td>
                <td className="px-5 py-3">{item.type}</td>
                <td className="px-5 py-3 text-amber-300">{item.risk}</td>
                <td className="px-5 py-3">
                  <Link to="/plans/change" className="text-xs text-brand-400 hover:underline">{item.action || 'View plan'}</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </PageShell>
  );
}
