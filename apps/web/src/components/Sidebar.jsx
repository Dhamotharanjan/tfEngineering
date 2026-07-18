import {
  LayoutDashboard,
  GitBranch,
  Network,
  FileText,
  Rocket,
  Tag,
  Database,
  DollarSign,
  FolderGit2,
  Activity,
  Eye,
  AlertTriangle,
  FileDown,
  Settings,
  Shield,
  ArrowLeftRight,
  Sparkles,
} from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { ORG } from '../data/mockData';

const nav = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/pitch', icon: Sparkles, label: 'Why InfraGraph' },
  { to: '/impact/modules-vpc', icon: Network, label: 'Blast Radius' },
  { to: '/dependencies', icon: GitBranch, label: 'Dependency Tree' },
  { to: '/graph/infra', icon: Network, label: 'Infra Graph' },
  { to: '/release-compare', icon: ArrowLeftRight, label: 'Release Compare' },
  { to: '/plans/change', icon: FileText, label: 'Change Plan' },
  { to: '/plans/rollout', icon: Rocket, label: 'Rollout Plan' },
  { to: '/releases/v3.0.0', icon: Tag, label: 'Release Tag Impact' },
  { to: '/lifecycle/rds', icon: Database, label: 'RDS Lifecycle' },
  { to: '/finops', icon: DollarSign, label: 'FinOps & Cost' },
  { to: '/observability', icon: Eye, label: 'Observability' },
  { to: '/eol', icon: AlertTriangle, label: 'EOL & Extended Support' },
  { to: '/repos', icon: FolderGit2, label: 'Repo Subscriptions' },
  { to: '/scanner', icon: Activity, label: 'Scanner Monitor' },
  { to: '/reports', icon: FileDown, label: 'CAB Reports' },
  { to: '/audit', icon: Shield, label: 'Audit Log' },
  { to: '/admin', icon: Settings, label: 'Admin' },
];

export default function Sidebar() {
  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-white/10 bg-surface-800/80">
      <div className="border-b border-white/10 px-5 py-5">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-500/20 ring-1 ring-brand-500/40">
            <GitBranch className="h-5 w-5 text-brand-400" />
          </div>
          <div>
            <div className="text-sm font-bold text-white">InfraGraph</div>
            <div className="text-[10px] text-slate-500">Change Intelligence</div>
          </div>
        </div>
        <div className="mt-3 rounded-lg bg-white/5 px-3 py-2 text-[11px] text-slate-400">
          {ORG.name} · {ORG.environment}
        </div>
      </div>
      <nav className="flex-1 space-y-0.5 overflow-y-auto p-3">
        {nav.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) => (isActive ? 'nav-link-active' : 'nav-link')}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {label}
          </NavLink>
        ))}
      </nav>
      <div className="border-t border-white/10 p-4">
        <div className="badge-info text-[10px]">Stakeholder Prototype v1.0</div>
        <p className="mt-2 text-[10px] leading-relaxed text-slate-500">
          Mock data for CTO / architect buy-in. Production will connect Neo4j, PostgreSQL, and GitHub webhooks.
        </p>
      </div>
    </aside>
  );
}
