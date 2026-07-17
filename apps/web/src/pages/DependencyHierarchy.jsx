import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ChevronDown,
  ChevronRight,
  FolderGit2,
  GitBranch,
  Network,
  Package,
  Wifi,
  WifiOff,
} from 'lucide-react';
import Header from '../components/Header';
import { PageShell, SectionTitle } from '../components/ui';
import { api } from '../api/client';
import { blastRadiusPathForRepo, moduleSlugForRepo } from '../config/blastRadiusModules';
import { resolveNodeVisual } from '../components/graphNodeVisuals';

const MOCK_TREE = {
  roots: [
    {
      id: 'upstream-core-network-modules',
      name: 'acme/terraform-modules-vpc',
      role: 'module_source',
      children: [
        {
          id: 'upstream-core-database-modules',
          name: 'acme/terraform-modules-rds',
          role: 'module_source',
          via: '../upstream-core-network-modules',
          children: [
            {
              id: 'team-database-platform-infra',
              name: 'acme/infra-payments-prod',
              role: 'downstream_consumer',
              via: '../upstream-core-database-modules',
              children: [],
            },
          ],
        },
        {
          id: 'team-storage-platform-infra',
          name: 'acme/infra-storage-prod',
          role: 'downstream_consumer',
          via: '../upstream-core-network-modules',
          children: [],
        },
      ],
    },
  ],
};

function roleIcon(role) {
  if (role === 'module_source') return FolderGit2;
  if (role === 'downstream_consumer') return GitBranch;
  return Package;
}

function TreeNode({ node, depth = 0, expanded, onToggle, selectedId, onSelect }) {
  const hasChildren = (node.children || []).length > 0;
  const isOpen = expanded.has(node.id);
  const isSelected = selectedId === node.id;
  const Icon = roleIcon(node.role);
  const visual = resolveNodeVisual({
    type: 'repository',
    detail: node.role,
    id: node.id,
  });

  return (
    <div className="select-none">
      <div
        className={`group flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition ${
          isSelected ? 'bg-brand-500/15 ring-1 ring-brand-500/40' : 'hover:bg-white/5'
        }`}
        style={{ paddingLeft: 8 + depth * 18 }}
      >
        <button
          type="button"
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-slate-500 hover:text-slate-200"
          onClick={(e) => {
            e.stopPropagation();
            if (hasChildren) onToggle(node.id);
          }}
          aria-label={hasChildren ? (isOpen ? 'Collapse' : 'Expand') : 'Leaf'}
        >
          {hasChildren ? (
            isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />
          ) : (
            <span className="h-1.5 w-1.5 rounded-full bg-slate-600" />
          )}
        </button>

        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          onClick={() => onSelect(node)}
          title="Open upstream ↔ downstream blast radius"
        >
          <span
            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md"
            style={{ background: visual.fill, color: visual.icon || '#fff' }}
          >
            <Icon size={13} strokeWidth={2.25} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium text-slate-100 group-hover:text-brand-300">
              {node.name || node.id}
            </span>
            <span className="block truncate font-mono text-[10px] text-slate-500">
              {node.id}
              {node.via ? ` · via ${node.via}` : ''}
            </span>
          </span>
          <span
            className={`badge-${node.role === 'module_source' ? 'info' : 'neutral'} shrink-0 text-[9px]`}
          >
            {node.role === 'module_source' ? 'upstream' : 'downstream'}
          </span>
          <Network className="h-3.5 w-3.5 shrink-0 text-slate-600 opacity-0 transition group-hover:opacity-100 group-hover:text-brand-400" />
        </button>
      </div>

      {hasChildren && isOpen && (
        <div>
          {node.children.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              onToggle={onToggle}
              selectedId={selectedId}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function buildHierarchy(subscriptions, depsByRepo) {
  const byId = Object.fromEntries(subscriptions.map((s) => [s.id, s]));
  const edges = [];

  for (const [repoId, deps] of Object.entries(depsByRepo)) {
    const refs = deps?.module_references || [];
    for (const ref of refs) {
      const source = String(ref.module_source || '');
      let upstreamId = null;
      if (source.includes('upstream-core-network')) upstreamId = 'upstream-core-network-modules';
      else if (source.includes('upstream-core-database')) upstreamId = 'upstream-core-database-modules';
      else if (source.includes('upstream-core-storage')) upstreamId = 'upstream-core-storage-modules';
      else if (source.includes('aws-network')) upstreamId = 'upstream-core-network-modules';
      else if (source.includes('aws-database')) upstreamId = 'upstream-core-database-modules';
      else if (source.includes('aws-storage')) upstreamId = 'upstream-core-storage-modules';

      if (upstreamId && byId[upstreamId] && byId[repoId] && upstreamId !== repoId) {
        edges.push({ from: upstreamId, to: repoId, via: source });
      }
    }
  }

  const childrenMap = {};
  for (const e of edges) {
    if (!childrenMap[e.from]) childrenMap[e.from] = [];
    if (!childrenMap[e.from].some((c) => c.id === e.to)) {
      childrenMap[e.from].push({
        id: e.to,
        name: byId[e.to]?.name || e.to,
        role: byId[e.to]?.role || 'downstream_consumer',
        via: e.via,
        children: [],
      });
    }
  }

  const attach = (node, path = new Set()) => {
    if (path.has(node.id)) return node;
    const nextPath = new Set(path);
    nextPath.add(node.id);
    const kids = (childrenMap[node.id] || []).map((c) =>
      attach({ ...c, children: [] }, nextPath),
    );
    return { ...node, children: kids };
  };

  const roots = subscriptions
    .filter((s) => s.role === 'module_source')
    .map((s) =>
      attach({
        id: s.id,
        name: s.name || s.id,
        role: s.role,
        children: [],
      }),
    );

  if (!roots.length) {
    return {
      roots: subscriptions.map((s) => ({
        id: s.id,
        name: s.name || s.id,
        role: s.role,
        children: [],
      })),
      edgeCount: edges.length,
    };
  }

  return { roots, edgeCount: edges.length };
}

export default function DependencyHierarchy() {
  const navigate = useNavigate();
  const [subscriptions, setSubscriptions] = useState([]);
  const [depsByRepo, setDepsByRepo] = useState({});
  const [live, setLive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);
  const [expanded, setExpanded] = useState(new Set());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const subs = await api.subscriptions();
        const map = {};
        await Promise.all(
          subs.map(async (s) => {
            try {
              map[s.id] = await api.repoDependencies(s.id);
            } catch {
              map[s.id] = { module_references: [], stack_dependencies: [], resource_dependencies: [] };
            }
          }),
        );
        if (!cancelled) {
          setSubscriptions(subs);
          setDepsByRepo(map);
          setLive(true);
          setError(null);
          setExpanded(new Set(subs.map((s) => s.id)));
        }
      } catch (e) {
        if (!cancelled) {
          setLive(false);
          setError(e.message);
          setSubscriptions([]);
          setDepsByRepo({});
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const tree = useMemo(() => {
    if (!live || !subscriptions.length) return MOCK_TREE;
    return buildHierarchy(subscriptions, depsByRepo);
  }, [live, subscriptions, depsByRepo]);

  const onToggle = useCallback((id) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const openBlastRadius = useCallback(
    (node) => {
      setSelected(node);
      navigate(blastRadiusPathForRepo(node.id, { slice: 'lineage', depth: 3 }));
    },
    [navigate],
  );

  const expandAll = () => {
    const ids = new Set();
    const walk = (nodes) => {
      for (const n of nodes) {
        ids.add(n.id);
        walk(n.children || []);
      }
    };
    walk(tree.roots || []);
    setExpanded(ids);
  };

  const selectedDeps = selected ? depsByRepo[selected.id] : null;

  return (
    <PageShell
      header={
        <Header
          title="Dependency Hierarchy"
          subtitle={`Layer 1 technical lineage · click a repo to open Blast Radius (upstream ↔ downstream)${live ? ' · live' : ' · mock'}`}
          actions={
            <div className="flex items-center gap-2">
              <span className={`badge-${live ? 'success' : 'neutral'} flex items-center gap-1`}>
                {live ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
                {live ? 'Live' : 'Mock'}
              </span>
              {selected && (
                <Link
                  to={blastRadiusPathForRepo(selected.id, { slice: 'lineage' })}
                  className="btn-primary inline-flex items-center gap-1.5"
                >
                  <Network className="h-3.5 w-3.5" />
                  Blast radius · {selected.id}
                </Link>
              )}
            </div>
          }
        />
      }
    >
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button type="button" className="btn-secondary text-xs" onClick={expandAll}>
          Expand all
        </button>
        <button type="button" className="btn-secondary text-xs" onClick={() => setExpanded(new Set())}>
          Collapse all
        </button>
        <span className="badge-info">{tree.roots?.length || 0} upstream roots</span>
        <span className="badge-neutral">{tree.edgeCount ?? '—'} dependency edges</span>
        <span className="text-[11px] text-slate-500">
          Click any node → Blast Radius lineage (upstream + downstream AWS resources)
        </span>
      </div>

      {error && !live && (
        <p className="mb-4 text-xs text-amber-400/90">API unavailable — showing mock hierarchy ({error})</p>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <SectionTitle>Upstream → Downstream tree</SectionTitle>
          <div className="card min-h-[480px] p-3">
            {loading ? (
              <div className="flex h-64 items-center justify-center text-sm text-slate-500">
                Loading dependency tree…
              </div>
            ) : (
              (tree.roots || []).map((root) => (
                <TreeNode
                  key={root.id}
                  node={root}
                  expanded={expanded}
                  onToggle={onToggle}
                  selectedId={selected?.id}
                  onSelect={openBlastRadius}
                />
              ))
            )}
          </div>
        </div>

        <div>
          <SectionTitle>Selected repo</SectionTitle>
          <div className="card p-4">
            {!selected ? (
              <p className="text-sm text-slate-500">
                Click a tree node to open Blast Radius for that repo’s upstream and downstream resources.
              </p>
            ) : (
              <div className="space-y-3">
                <div>
                  <div className="text-xs text-slate-500">Opening blast radius for</div>
                  <div className="font-medium text-white">{selected.name || selected.id}</div>
                  <div className="font-mono text-[11px] text-slate-500">{selected.id}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">Role</div>
                  <div className="text-sm text-slate-200">{selected.role}</div>
                </div>
                <div>
                  <div className="mb-1.5 text-xs text-slate-500">Module references</div>
                  <ul className="space-y-1.5">
                    {(selectedDeps?.module_references || []).length === 0 && (
                      <li className="text-xs text-slate-500">No module references stored</li>
                    )}
                    {(selectedDeps?.module_references || []).map((m, i) => (
                      <li key={`${m.module_source}-${i}`} className="rounded-md bg-white/5 px-2 py-1.5">
                        <div className="flex items-center gap-1.5 font-mono text-[10px] text-brand-300">
                          <Package className="h-3 w-3 shrink-0" />
                          <span className="truncate">{m.module_source}</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
                <Link
                  to={blastRadiusPathForRepo(selected.id, { slice: 'lineage' })}
                  className="btn-primary inline-flex w-full items-center justify-center gap-1.5 text-xs"
                >
                  <Network className="h-3.5 w-3.5" />
                  Open lineage blast radius
                </Link>
                <Link
                  to={`/impact/${moduleSlugForRepo(selected.id)}?repoId=${encodeURIComponent(selected.id)}&slice=component`}
                  className="btn-secondary inline-flex w-full items-center justify-center gap-1.5 text-xs"
                >
                  Resources only (this repo)
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>
    </PageShell>
  );
}
