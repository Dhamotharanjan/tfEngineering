import { Bell, Search } from 'lucide-react';

export default function Header({ title, subtitle, actions }) {
  return (
    <header className="border-b border-white/10 bg-surface-900/80 px-6 py-4 backdrop-blur">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-white">{title}</h1>
          {subtitle && <p className="mt-0.5 text-sm text-slate-400">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-400 md:flex">
            <Search className="h-4 w-4" />
            <span>Search modules, stacks, teams…</span>
          </div>
          <button type="button" className="btn-secondary !p-2">
            <Bell className="h-4 w-4" />
          </button>
          {actions}
        </div>
      </div>
    </header>
  );
}
