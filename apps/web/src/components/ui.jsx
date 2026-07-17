export function MetricCard({ label, value, sub, variant = 'default' }) {
  const ring =
    variant === 'critical'
      ? 'ring-red-500/30'
      : variant === 'warning'
        ? 'ring-amber-500/30'
        : 'ring-white/10';
  return (
    <div className={`card p-4 ring-1 ${ring}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value mt-1">{value}</div>
      {sub && <div className="mt-1 text-xs text-slate-500">{sub}</div>}
    </div>
  );
}

export function PageShell({ header, children }) {
  return (
    <>
      {header}
      <div className="flex-1 overflow-y-auto p-6">{children}</div>
    </>
  );
}

export function SectionTitle({ children, action }) {
  return (
    <div className="mb-4 flex items-center justify-between">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">{children}</h2>
      {action}
    </div>
  );
}
