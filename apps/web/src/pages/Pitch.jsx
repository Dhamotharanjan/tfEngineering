import { Link } from 'react-router-dom';
import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  DollarSign,
  FolderGit2,
  GitBranch,
  Network,
  Shield,
  Zap,
} from 'lucide-react';
import Header from '../components/Header';
import { PageShell, SectionTitle } from '../components/ui';
import { DEFAULT_MODULE_SLUG } from '../config/blastRadiusModules';

const PILLARS = [
  {
    id: 1,
    icon: BookOpen,
    eyebrow: 'Core idea 1',
    title: 'Existing infrastructure code → org knowledge → quick turnaround',
    summary:
      'Use the Terraform and Terragrunt you already run. InfraGraph turns that estate into shared knowledge so teams can orient and change faster—without rediscovering dependencies by hand.',
    how: [
      'Continuously scan subscribed repos and build a living knowledge graph of modules, stacks, and cloud resources.',
      'Classify reusable patterns (Layer 1) and application topology (Layer 2) so architects and engineers share one map.',
      'Surface dependency hierarchy and module interface diffs so upgrade paths are visible before work starts.',
      'Cut turnaround: know what exists, who owns it, and what to touch—before the first PR.',
    ],
    see: 'Pattern catalog with stamp-ready architecture canvas, then application-scoped graphs and upgrade compare.',
    screens: [
      { to: '/graph/infra?tab=patterns', label: 'Infra Graph · Patterns', primary: true },
      { to: '/dependencies', label: 'Dependency Tree' },
      { to: '/release-compare', label: 'Release Compare' },
    ],
  },
  {
    id: 2,
    icon: Shield,
    eyebrow: 'Core idea 2',
    title: 'Org-wide IaaC for Security, FinOps, and architect forums',
    summary:
      'One operating picture for the entire organization’s infrastructure-as-code—ready for security review, cost stewardship, and internal or external architecture and auditor forums.',
    how: [
      'Architect, FinOps, and Risk panels on each pattern, plus compliance stamps (e.g. SOC2) for external auditors.',
      'FinOps attribution: module → account → service spend, including extended-support and waste signals.',
      'Observability and EOL views keep patch posture and technical-debt tax visible to leadership.',
      'CAB reports and audit trail give change advisory boards and auditors exportable evidence.',
    ],
    see: 'Stamp a pattern architecture, then open cost, EOL, CAB export, and audit screens in the same portal.',
    screens: [
      { to: '/graph/infra?tab=patterns', label: 'Patterns · Stamp & forums', primary: true },
      { to: '/finops', label: 'FinOps & Cost' },
      { to: '/observability', label: 'Observability' },
      { to: '/eol', label: 'EOL & Extended Support' },
      { to: '/reports', label: 'CAB Reports' },
      { to: '/audit', label: 'Audit Log' },
    ],
  },
  {
    id: 3,
    icon: Zap,
    eyebrow: 'Core idea 3',
    title: 'Accept upstream change—and ripple safely downstream',
    summary:
      'When a shared module or release tag moves, InfraGraph shows who is affected and sequences the path from platform change to application consumers.',
    how: [
      'Blast radius maps upstream publishers to every downstream consumer, stack, and resource slice.',
      'Mandatory release-tag impact analysis queues who must act when versions merge.',
      'Guided change plans and per-consumer rollout (canary, gates, rollback) turn impact into an executable path.',
      'Teams stop guessing blast radius—and start applying upstream change with a controlled downstream ripple.',
    ],
    see: 'Upstream/downstream graph for a module, then release-tag impact and phased change/rollout plans.',
    screens: [
      { to: `/impact/${DEFAULT_MODULE_SLUG}`, label: 'Blast Radius', primary: true },
      { to: '/releases/v3.0.0', label: 'Release Tag Impact' },
      { to: '/plans/change', label: 'Change Plan' },
      { to: '/plans/rollout', label: 'Rollout Plan' },
    ],
  },
  {
    id: 4,
    icon: FolderGit2,
    eyebrow: 'Core idea 4',
    title: 'Subscription model—teams opt in and gain the benefits',
    summary:
      'Coverage is entitlement-based. Interested teams subscribe their repos into the org graph and immediately participate in knowledge, impact, and governance workflows.',
    how: [
      'Opt-in subscriptions decide which repos seed the shared knowledge graph.',
      'Roles (module source vs downstream consumer) and tiers clarify how each team participates.',
      'Sync and scan bring subscribed repos into lineage, patterns, and impact pipelines—without owning the platform.',
      'Unsubscribed work stays out of the graph until a team chooses to join.',
    ],
    see: 'Repo subscription list with roles, tiers, scan status, and links into blast radius; Dashboard shows subscribed coverage.',
    screens: [
      { to: '/repos', label: 'Repo Subscriptions', primary: true },
      { to: '/', label: 'Executive Dashboard' },
    ],
    benefits: [
      'Inclusion in the org knowledge and infra pattern graph',
      'Blast-radius and upstream/downstream lineage for your repos',
      'Release-tag and module upgrade impact before merge',
      'Guided change and rollout plans for downstream consumers',
      'FinOps and EOL visibility attributed to your stacks',
      'CAB- and audit-ready exports for change forums',
      'Scan/sync into the shared graph without owning the whole platform',
    ],
  },
];

const DEMO_PATH = [
  { step: 1, to: '/repos', label: 'Subscribe repos', hint: 'Opt in coverage' },
  { step: 2, to: '/graph/infra?tab=patterns', label: 'Infra Graph', hint: 'Knowledge & architecture' },
  { step: 3, to: `/impact/${DEFAULT_MODULE_SLUG}`, label: 'Blast Radius', hint: 'Upstream → downstream' },
  { step: 4, to: '/release-compare', label: 'Release Compare', hint: 'Upgrade path' },
  { step: 5, to: '/plans/change', label: 'Change & Rollout', hint: 'Apply the ripple' },
  { step: 6, to: '/finops', label: 'FinOps & CAB', hint: 'Cost & forums' },
];

export default function Pitch() {
  return (
    <PageShell
      header={
        <Header
          title="Why InfraGraph"
          subtitle="Four core ideas — open each live screen to see how we address them"
        />
      }
    >
      <div className="card mb-8 overflow-hidden">
        <div className="border-b border-white/10 bg-brand-500/10 px-6 py-6">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-brand-400">
            <GitBranch className="h-4 w-4" />
            InfraGraph · Change Intelligence
          </div>
          <h2 className="mt-3 max-w-3xl text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            Turn existing Terraform and IaaC into org knowledge—so change is fast, governed, and safe.
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-slate-400">
            This pitch is the spine of the product: knowledge from what you already run, org-wide Security and
            FinOps for architect forums, upstream change that ripples cleanly downstream, and a subscription model
            so interested teams gain the benefits.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Link to="/repos" className="btn-primary">
              Start at Subscriptions <ArrowRight className="h-4 w-4" />
            </Link>
            <Link to="/graph/infra?tab=patterns" className="btn-secondary">
              Open Infra Graph
            </Link>
          </div>
        </div>
        <div className="grid gap-px bg-white/10 sm:grid-cols-2 lg:grid-cols-4">
          {PILLARS.map((p) => {
            const Icon = p.icon;
            return (
              <a
                key={p.id}
                href={`#pillar-${p.id}`}
                className="bg-surface-900 px-4 py-4 transition hover:bg-white/[0.04]"
              >
                <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-slate-500">
                  <Icon className="h-3.5 w-3.5 text-brand-400" />
                  Pillar {p.id}
                </div>
                <div className="mt-2 text-sm font-medium leading-snug text-slate-200">
                  {p.id === 1 && 'Existing code → knowledge'}
                  {p.id === 2 && 'Security · FinOps · forums'}
                  {p.id === 3 && 'Upstream → downstream'}
                  {p.id === 4 && 'Subscribe & benefit'}
                </div>
              </a>
            );
          })}
        </div>
      </div>

      <SectionTitle>The four core ideas</SectionTitle>

      <div className="space-y-6">
        {PILLARS.map((pillar) => {
          const Icon = pillar.icon;
          return (
            <section key={pillar.id} id={`pillar-${pillar.id}`} className="card scroll-mt-6">
              <div className="card-header flex flex-wrap items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-500/20 ring-1 ring-brand-500/40">
                  <Icon className="h-5 w-5 text-brand-400" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-brand-400">
                    {pillar.eyebrow}
                  </div>
                  <h3 className="mt-1 text-lg font-semibold text-white">{pillar.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-400">{pillar.summary}</p>
                </div>
              </div>
              <div className="card-body space-y-5">
                <div>
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
                    How we address it
                  </div>
                  <ul className="space-y-2">
                    {pillar.how.map((item) => (
                      <li key={item} className="flex gap-2 text-sm text-slate-300">
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-brand-400" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {pillar.benefits && (
                  <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4">
                    <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                      <DollarSign className="h-3.5 w-3.5 text-brand-400" />
                      Benefits for subscribed teams
                    </div>
                    <ul className="grid gap-2 sm:grid-cols-2">
                      {pillar.benefits.map((b) => (
                        <li key={b} className="flex gap-2 text-sm text-slate-300">
                          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                          <span>{b}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="rounded-lg border border-dashed border-white/10 bg-white/[0.02] px-4 py-3">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                    What you’ll see on screen
                  </div>
                  <p className="mt-1 text-sm text-slate-400">{pillar.see}</p>
                </div>

                <div className="flex flex-wrap gap-2">
                  {pillar.screens.map((s) => (
                    <Link
                      key={s.to}
                      to={s.to}
                      className={s.primary ? 'btn-primary' : 'btn-secondary'}
                    >
                      {s.primary ? <Network className="h-4 w-4" /> : null}
                      {s.label}
                      <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  ))}
                </div>
              </div>
            </section>
          );
        })}
      </div>

      <div className="mt-8">
        <SectionTitle>Recommended demo path</SectionTitle>
        <div className="card p-5">
          <p className="mb-4 text-sm text-slate-400">
            Walk the four ideas in order—subscriptions first, then knowledge, ripple, upgrade, apply, govern.
          </p>
          <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {DEMO_PATH.map((d) => (
              <li key={d.step}>
                <Link
                  to={d.to}
                  className="flex items-start gap-3 rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3 transition hover:border-brand-500/40 hover:bg-brand-500/5"
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-brand-500/20 text-xs font-bold text-brand-400">
                    {d.step}
                  </span>
                  <span>
                    <span className="block text-sm font-medium text-white">{d.label}</span>
                    <span className="text-xs text-slate-500">{d.hint}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ol>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link to="/plans/rollout" className="btn-secondary text-xs">
              Also open Rollout Plan
            </Link>
            <Link to="/reports" className="btn-secondary text-xs">
              CAB Reports
            </Link>
          </div>
        </div>
      </div>
    </PageShell>
  );
}
