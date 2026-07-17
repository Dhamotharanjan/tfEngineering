import Header from '../components/Header';
import { MetricCard, PageShell, SectionTitle } from '../components/ui';
import { finopsBreakdown, releaseTag } from '../data/mockData';

export default function FinOps() {
  return (
    <PageShell
      header={
        <Header
          title="FinOps & Cost Attribution"
          subtitle="CUR + Cost Explorer mapped via registry JSON — module → account → service"
        />
      }
    >
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <MetricCard label="VPC module affected spend" value={`$${(releaseTag.impact.monthlyCostUsd / 1000).toFixed(1)}K`} sub="23 stacks · 4 accounts" />
        <MetricCard label="Extended support tax" value="$1,314/mo" sub="EKS + Oracle EC2" variant="critical" />
        <MetricCard label="DR test waste" value="$420/mo" sub="Decommission scheduled" variant="warning" />
      </div>

      <SectionTitle>Cost breakdown by category (Neo4j COSTS edges + PG aggregates)</SectionTitle>
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10 text-left text-xs text-slate-500">
              <th className="px-5 py-3">Category</th>
              <th className="px-5 py-3">Monthly USD</th>
              <th className="px-5 py-3">%</th>
              <th className="px-5 py-3">Trend</th>
            </tr>
          </thead>
          <tbody>
            {finopsBreakdown.map((row) => (
              <tr key={row.category} className="table-row">
                <td className="px-5 py-3 text-white">{row.category}</td>
                <td className="px-5 py-3 font-mono">${row.amount.toLocaleString()}</td>
                <td className="px-5 py-3">{row.pct}%</td>
                <td className="px-5 py-3 text-slate-400">{row.trend}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </PageShell>
  );
}
