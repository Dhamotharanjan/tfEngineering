import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeftRight,
  BookOpen,
  CheckCircle2,
  Copy,
  ExternalLink,
  GitPullRequest,
  Loader2,
  MessageSquare,
  RefreshCw,
  Send,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import Header from '../components/Header';
import { MetricCard, PageShell, SectionTitle } from '../components/ui';
import { api } from '../api/client';
import { useApiData } from '../api/useApiData';

const DEMO_FALLBACK_MODULES = [
  {
    module_id: 'upstream-core-network-modules',
    display_name: 'Core Network / VPC',
    versions: ['v2.4.2', 'v3.0.0', 'v2026.07.0', 'v2026.07.1'],
    consumer_count: 3,
  },
];

function severityBadge(severity) {
  if (severity === 'critical') return 'badge-critical';
  if (severity === 'high') return 'badge-warning';
  if (severity === 'medium') return 'badge-info';
  if (severity === 'low') return 'badge-neutral';
  return 'badge-success';
}

function formatDefault(value) {
  if (value === undefined || value === null) return '«required»';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function DiffPanel({ title, count, tone, children, empty }) {
  const ring =
    tone === 'danger'
      ? 'ring-red-500/20'
      : tone === 'warn'
        ? 'ring-amber-500/20'
        : tone === 'ok'
          ? 'ring-emerald-500/20'
          : 'ring-cyan-500/20';
  return (
    <div className={`card flex min-h-[220px] flex-col ring-1 ${ring}`}>
      <div className="card-header flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white">{title}</h3>
        <span className="font-mono text-xs text-slate-400">{count}</span>
      </div>
      <div className="card-body flex-1 space-y-2 overflow-y-auto text-sm">
        {count ? children : <p className="text-xs text-slate-500">{empty}</p>}
      </div>
    </div>
  );
}

function VarRow({ name, detail, meta }) {
  return (
    <div className="rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2">
      <div className="font-mono text-xs text-brand-400">{name}</div>
      {detail && <div className="mt-1 text-[11px] text-slate-400">{detail}</div>}
      {meta && <div className="mt-1 font-mono text-[10px] text-slate-500">{meta}</div>}
    </div>
  );
}

function prereqStatusClass(status) {
  if (status === 'pass') return 'text-emerald-300';
  if (status === 'fail') return 'text-red-300';
  if (status === 'not_applicable') return 'text-slate-500';
  return 'text-amber-300';
}

function PrereqChatPanel({ request, onUpdated }) {
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const messages = request.chat_messages || [];

  async function send() {
    const text = draft.trim();
    if (!text || !request.id) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.releasePrChat(request.id, { message: text, persist: true });
      if (res?.error) throw new Error(res.message || res.error);
      setDraft('');
      if (res.request) onUpdated?.(res.request);
      else if (res.chat_messages) onUpdated?.({ ...request, chat_messages: res.chat_messages });
    } catch (e) {
      setError(e.message || 'Chat failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-white/10 bg-surface-900/40 p-3 flex flex-col min-h-[220px] max-h-[320px]">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-100">
        <MessageSquare className="h-4 w-4 text-cyan-400" />
        Engineer chat
        <span className="text-[10px] font-normal text-slate-500">scoped to this PR</span>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto text-[11px] mb-2 pr-1">
        {!messages.length && (
          <p className="text-slate-500">
            Ask about Path A/B, restart/downtime, snapshot/AMI prereqs, Multi-AZ order, or target resource impact.
          </p>
        )}
        {messages.map((m, i) => (
          <div
            key={`${m.at || i}-${m.role}`}
            className={`rounded-md px-2 py-1.5 ${
              m.role === 'user' ? 'bg-brand-500/10 text-slate-200 ml-4' : 'bg-white/[0.03] text-slate-300 mr-2'
            }`}
          >
            <div className="text-[9px] uppercase tracking-wider text-slate-500 mb-0.5">
              {m.role}
              {m.degraded ? ' · offline' : ''}
            </div>
            <div className="whitespace-pre-wrap">{m.content}</div>
            {Array.isArray(m.citations) && m.citations.length > 0 && (
              <ul className="mt-1 space-y-0.5">
                {m.citations.map((c) => (
                  <li key={c.url}>
                    <a
                      href={c.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-brand-400 hover:underline inline-flex items-center gap-1"
                    >
                      {c.title || c.url}
                      <ExternalLink className="h-2.5 w-2.5" />
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          className="flex-1 rounded-lg border border-white/10 bg-surface-900 px-2 py-1.5 text-xs text-slate-100"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder="e.g. Do we need a snapshot for Path B?"
          disabled={busy || !request.id}
        />
        <button type="button" className="btn-secondary !py-1.5 !px-2 text-xs" disabled={busy || !draft.trim()} onClick={send}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
        </button>
      </div>
      {error && <p className="mt-1 text-[10px] text-red-300">{error}</p>}
    </div>
  );
}

function AiRecommendationPanel({ request, approvers, onUpdated }) {
  const [approver, setApprover] = useState(approvers?.[0] || '');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (approvers?.length && !approver) setApprover(approvers[0]);
  }, [approvers, approver]);

  const rec = request.recommendations || request.analysis?.recommendations || {};
  const downtime = rec.downtime_required ?? request.downtime_required;
  const requiresRestart = rec.requires_restart ?? request.requires_restart;
  const duration = rec.estimated_duration || request.estimated_duration;
  const category = rec.upgrade_category || request.upgrade_category;
  const upgradePaths = rec.upgrade_paths || request.upgrade_paths || [];
  const prerequisites = rec.prerequisites || request.prerequisites || {};
  const prereqChecklist = prerequisites.checklist || [];
  const multiAz = rec.multi_az_plan || request.multi_az_plan;
  const alternatives = rec.alternatives || request.alternatives || [];
  const citations = rec.doc_citations || request.doc_citations || [];
  const docsSource = rec.docs_source || request.docs_source;
  const approvalState = request.approval_state || 'awaiting_approval';
  const approved = approvalState === 'approved';
  const rejected = approvalState === 'rejected';
  const awaiting = approvalState === 'awaiting_approval' || request.status === 'awaiting_approval';

  async function act(kind) {
    if (!approver.trim()) {
      setError('Select or enter a git approver');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const body = { approver: approver.trim(), comment: comment || undefined };
      const updated =
        kind === 'approve'
          ? await api.approveReleasePr(request.id, body)
          : await api.rejectReleasePr(request.id, body);
      if (updated?.error) throw new Error(updated.message || updated.error);
      onUpdated?.(updated);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.02] px-4 py-3 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs text-brand-400">{request.repo_id}</span>
        <span className="badge-info">{request.status}</span>
        <span className="badge-neutral">{approvalState}</span>
        {docsSource && <span className="badge-neutral">docs: {docsSource}</span>}
      </div>
      <p className="text-[11px] text-slate-400">{request.message}</p>

      <div className="grid gap-3 lg:grid-cols-5">
        <div className="lg:col-span-3 rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-3">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-cyan-100">
            <BookOpen className="h-4 w-4" />
            AI recommendations
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-sm">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-slate-500">Restart</div>
              <div className={requiresRestart ? 'text-amber-300' : 'text-emerald-300'}>
                {requiresRestart == null ? '—' : requiresRestart ? 'Required' : 'Not required'}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-slate-500">Downtime</div>
              <div className={downtime ? 'text-amber-300' : 'text-emerald-300'}>
                {downtime == null ? '—' : downtime ? 'Required' : 'Not required'}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-slate-500">Estimated duration</div>
              <div className="text-slate-200 text-xs">{duration || '—'}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-slate-500">Upgrade category</div>
              <div className="text-slate-200 text-xs">{category || '—'}</div>
            </div>
          </div>

          {upgradePaths.length > 0 && (
            <div className="mt-3">
              <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Upgrade paths</div>
              <div className="space-y-2">
                {upgradePaths.map((p) => (
                  <div
                    key={p.id}
                    className={`rounded-md border px-2.5 py-2 text-xs ${
                      p.recommended
                        ? 'border-emerald-500/30 bg-emerald-500/5 text-slate-200'
                        : 'border-white/10 bg-white/[0.02] text-slate-400'
                    }`}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-slate-100">{p.name}</span>
                      {p.recommended && <span className="badge-success !text-[9px]">recommended</span>}
                      <span className="text-[10px] text-slate-500">
                        restart={String(p.requires_restart)} · downtime={String(p.requires_downtime)}
                      </span>
                    </div>
                    {p.summary && <p className="mt-1 text-[11px] text-slate-400">{p.summary}</p>}
                    {p.when_to_use && (
                      <p className="mt-0.5 text-[10px] text-slate-500">When: {p.when_to_use}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {(prereqChecklist.length > 0 || prerequisites.snapshot_required != null) && (
            <div className="mt-3">
              <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">
                Hard prerequisites
              </div>
              <ul className="space-y-1.5">
                {(prereqChecklist.length
                  ? prereqChecklist
                  : [
                      {
                        id: 'snapshot',
                        label: 'SNAPSHOT required before change',
                        required: prerequisites.snapshot_required,
                        status: prerequisites.snapshot_status,
                        evidence: prerequisites.snapshot_evidence,
                      },
                      {
                        id: 'ami',
                        label: 'AMI / golden image verified',
                        required: prerequisites.ami_required,
                        status: prerequisites.ami_status,
                        evidence: prerequisites.ami_evidence,
                      },
                    ]
                ).map((item) => (
                  <li key={item.id} className="rounded-md border border-white/5 bg-white/[0.02] px-2 py-1.5">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="text-slate-200">{item.label}</span>
                      <span className="text-[10px] text-slate-500">
                        required={String(item.required)}
                      </span>
                      <span className={`font-mono text-[10px] ${prereqStatusClass(item.status)}`}>
                        {item.status || 'unknown'}
                      </span>
                    </div>
                    {item.evidence && (
                      <p className="mt-0.5 text-[10px] text-slate-500">{item.evidence}</p>
                    )}
                  </li>
                ))}
              </ul>
              {Array.isArray(prerequisites.blocking) && prerequisites.blocking.length > 0 && (
                <p className="mt-1.5 text-[10px] text-amber-300/90">
                  Blocking until confirmed: {prerequisites.blocking.join(', ')}
                </p>
              )}
            </div>
          )}

          {multiAz && (
            <div className="mt-3">
              <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Multi-AZ plan</div>
              <p className="text-xs text-slate-300">{multiAz.summary}</p>
              {Array.isArray(multiAz.order) && multiAz.order.length > 0 && (
                <ol className="mt-2 list-decimal list-inside space-y-1 text-[11px] text-slate-400">
                  {multiAz.order.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
              )}
            </div>
          )}

          {alternatives.length > 0 && (
            <div className="mt-3">
              <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Other approaches</div>
              <ul className="space-y-1.5">
                {alternatives.map((a) => (
                  <li key={a.name} className="text-xs text-slate-300">
                    <span className="font-medium text-slate-100">{a.name}</span>
                    {a.description ? ` — ${a.description}` : ''}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {citations.length > 0 && (
            <div className="mt-3">
              <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">AWS documentation</div>
              <ul className="space-y-1">
                {citations.map((c) => (
                  <li key={c.url} className="text-[11px]">
                    <a
                      href={c.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-brand-400 hover:underline inline-flex items-center gap-1"
                    >
                      {c.title || c.url}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                    {c.fetched === false && (
                      <span className="ml-2 text-slate-600">(catalog — fetch pending/failed)</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="lg:col-span-2">
          <PrereqChatPanel request={request} onUpdated={onUpdated} />
        </div>
      </div>

      <div className="rounded-lg border border-white/10 bg-surface-900/60 p-3">
        <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-100">
          <ShieldCheck className="h-4 w-4 text-emerald-400" />
          Git approver gate
        </div>
        {awaiting && !approved && !rejected && (
          <div className="space-y-2">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wider text-slate-500">Approver</span>
              {approvers?.length ? (
                <select
                  className="rounded-lg border border-white/10 bg-surface-900 px-3 py-2 text-sm text-slate-100"
                  value={approver}
                  onChange={(e) => setApprover(e.target.value)}
                >
                  {approvers.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  className="rounded-lg border border-white/10 bg-surface-900 px-3 py-2 text-sm text-slate-100"
                  value={approver}
                  onChange={(e) => setApprover(e.target.value)}
                  placeholder="approver identity"
                />
              )}
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wider text-slate-500">Comment (optional)</span>
              <input
                className="rounded-lg border border-white/10 bg-surface-900 px-3 py-2 text-sm text-slate-100"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="e.g. maintenance window Fri 02:00 UTC"
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn-primary !py-1.5 text-xs"
                disabled={busy}
                onClick={() => act('approve')}
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                Approve & queue PR
              </button>
              <button
                type="button"
                className="btn-secondary !py-1.5 text-xs"
                disabled={busy}
                onClick={() => act('reject')}
              >
                <XCircle className="h-3.5 w-3.5" />
                Reject
              </button>
            </div>
          </div>
        )}
        {approved && (
          <div className="space-y-1 text-xs text-emerald-300">
            <p>
              Approved by <span className="font-mono">{request.approver}</span>
              {request.approved_at ? ` · ${new Date(request.approved_at).toLocaleString()}` : ''}
            </p>
            <p className="text-slate-400">PR proceed path unlocked — status: {request.status}</p>
            {request.job_id && (
              <p className="font-mono text-[10px] text-slate-500">job {request.job_id}</p>
            )}
          </div>
        )}
        {rejected && (
          <p className="text-xs text-red-300">
            Rejected by <span className="font-mono">{request.approver}</span>
            {request.approval_comment ? ` — ${request.approval_comment}` : ''}
          </p>
        )}
        {error && <p className="mt-2 text-xs text-red-300">{error}</p>}
      </div>
    </div>
  );
}

export default function ReleaseCompare() {
  const { data: modules, live, loading: modulesLoading, reload: reloadModules } = useApiData(
    api.releaseCompareModules,
    DEMO_FALLBACK_MODULES,
  );

  const [moduleId, setModuleId] = useState('');
  const [fromVersion, setFromVersion] = useState('');
  const [toVersion, setToVersion] = useState('');
  const [releasesInfo, setReleasesInfo] = useState(null);
  const [compare, setCompare] = useState(null);
  const [comparing, setComparing] = useState(false);
  const [compareError, setCompareError] = useState(null);
  const [selectedRepos, setSelectedRepos] = useState(() => new Set());
  const [prStatus, setPrStatus] = useState(null);
  const [raising, setRaising] = useState(false);
  const [copyNote, setCopyNote] = useState(null);
  const [approvers, setApprovers] = useState([]);

  const moduleList = Array.isArray(modules) ? modules : [];

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const info = await api.releaseCompareApprovers();
        if (!cancelled) setApprovers(info?.approvers || []);
      } catch {
        if (!cancelled) setApprovers([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!moduleList.length) return;
    if (!moduleId || !moduleList.some((m) => m.module_id === moduleId)) {
      setModuleId(moduleList[0].module_id);
    }
  }, [moduleList, moduleId]);

  useEffect(() => {
    if (!moduleId) return;
    let cancelled = false;
    (async () => {
      try {
        const info = await api.releaseCompareReleases(moduleId);
        if (cancelled) return;
        setReleasesInfo(info);
        const versions = (info.releases || []).map((r) => r.version);
        const suggestedFrom = info.suggested_from || versions[0] || '';
        const suggestedTo =
          info.suggested_to ||
          versions.find((v) => v !== suggestedFrom) ||
          versions[versions.length - 1] ||
          '';
        setFromVersion(suggestedFrom);
        setToVersion(suggestedTo);
      } catch {
        if (cancelled) return;
        const fallback = moduleList.find((m) => m.module_id === moduleId);
        const versions = fallback?.versions || [];
        setReleasesInfo({
          module_id: moduleId,
          releases: versions.map((version) => ({ version })),
          suggested_from: versions[0],
          suggested_to: versions[versions.length - 1],
        });
        setFromVersion(versions[0] || '');
        setToVersion(versions[versions.length - 1] || '');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [moduleId]);

  const versions = useMemo(
    () => (releasesInfo?.releases || []).map((r) => r.version),
    [releasesInfo],
  );

  async function runCompare() {
    if (!moduleId || !fromVersion || !toVersion) return;
    setComparing(true);
    setCompareError(null);
    setPrStatus(null);
    try {
      const result = await api.releaseCompare({
        moduleId,
        fromVersion,
        toVersion,
      });
      if (result?.error) {
        setCompareError(result.message || result.error);
        setCompare(null);
      } else {
        setCompare(result);
        setSelectedRepos(new Set());
      }
    } catch (e) {
      setCompareError(e.message);
      setCompare(null);
    } finally {
      setComparing(false);
    }
  }

  function useDownstreamPin() {
    const suggested = releasesInfo?.suggested_from;
    if (suggested) setFromVersion(suggested);
  }

  function toggleRepo(repoId) {
    setSelectedRepos((prev) => {
      const next = new Set(prev);
      if (next.has(repoId)) next.delete(repoId);
      else next.add(repoId);
      return next;
    });
  }

  function selectImpacted() {
    if (!compare?.consumers) return;
    const ids = compare.consumers
      .filter((c) => c.severity !== 'none' && c.current_pin !== toVersion)
      .map((c) => c.repo_id);
    setSelectedRepos(new Set(ids));
  }

  async function raisePrs(repoIds) {
    if (!repoIds.length) return;
    setRaising(true);
    setPrStatus(null);
    try {
      let result;
      if (repoIds.length === 1) {
        result = {
          count: 1,
          results: [
            await api.raiseReleasePr({
              repo_id: repoIds[0],
              module_id: moduleId,
              from_version: fromVersion,
              to_version: toVersion,
            }),
          ],
        };
      } else {
        result = await api.raiseReleasePrBulk({
          repo_ids: repoIds,
          module_id: moduleId,
          from_version: fromVersion,
          to_version: toVersion,
        });
      }
      setPrStatus(result);
    } catch (e) {
      setPrStatus({ error: e.message });
    } finally {
      setRaising(false);
    }
  }

  function updatePrResult(updated) {
    setPrStatus((prev) => {
      if (!prev) return { count: 1, results: [updated] };
      const results = (prev.results || [prev]).map((r) => (r.id === updated.id ? updated : r));
      return { ...prev, results };
    });
  }

  async function copySummary() {
    if (!compare) return;
    const d = compare.diff;
    const lines = [
      `Release compare: ${compare.display_name || moduleId}`,
      `${fromVersion} → ${toVersion}`,
      `Variables: +${d.variables.added.length} / -${d.variables.removed.length} / mandatory ${d.variables.made_mandatory.length} / changed ${d.variables.changed.length}`,
      `Outputs: +${d.outputs.added.length} / -${d.outputs.removed.length}`,
      `Consumers: ${compare.impact_summary?.consumer_count || 0} (critical ${compare.impact_summary?.critical || 0})`,
      '',
      'Downstream:',
      ...(compare.consumers || []).map(
        (c) =>
          `- ${c.github_full_name || c.repo_id} pin=${c.current_pin} severity=${c.severity}`,
      ),
    ];
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setCopyNote('Copied');
      setTimeout(() => setCopyNote(null), 1500);
    } catch {
      setCopyNote('Copy failed');
    }
  }

  const diff = compare?.diff;
  const summary = compare?.impact_summary;

  return (
    <PageShell
      header={
        <Header
          title="Release Compare"
          subtitle="Module interface diff + downstream pin impact — engineer workbench"
          actions={
            <div className="flex items-center gap-2">
              {live ? (
                <span className="badge-success">Live API</span>
              ) : (
                <span className="badge-warning">Demo fallback</span>
              )}
              <button type="button" className="btn-secondary !px-3" onClick={reloadModules}>
                <RefreshCw className="h-3.5 w-3.5" />
              </button>
            </div>
          }
        />
      }
    >
      <div className="card mb-6">
        <div className="card-body grid gap-4 lg:grid-cols-12">
          <label className="flex flex-col gap-1.5 lg:col-span-4">
            <span className="text-[11px] uppercase tracking-wider text-slate-500">Module</span>
            <select
              className="rounded-lg border border-white/10 bg-surface-900 px-3 py-2 font-mono text-sm text-slate-100"
              value={moduleId}
              onChange={(e) => setModuleId(e.target.value)}
              disabled={modulesLoading}
            >
              {moduleList.map((m) => (
                <option key={m.module_id} value={m.module_id}>
                  {m.display_name || m.module_id}
                  {m.consumer_count != null ? ` · ${m.consumer_count} consumers` : ''}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1.5 lg:col-span-3">
            <span className="text-[11px] uppercase tracking-wider text-slate-500">From release</span>
            <select
              className="rounded-lg border border-white/10 bg-surface-900 px-3 py-2 font-mono text-sm text-slate-100"
              value={fromVersion}
              onChange={(e) => setFromVersion(e.target.value)}
            >
              {versions.map((v) => (
                <option key={v} value={v}>
                  {v}
                  {releasesInfo?.pin_distribution?.[v]
                    ? ` · ${releasesInfo.pin_distribution[v]} pins`
                    : ''}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1.5 lg:col-span-3">
            <span className="text-[11px] uppercase tracking-wider text-slate-500">To release</span>
            <select
              className="rounded-lg border border-white/10 bg-surface-900 px-3 py-2 font-mono text-sm text-slate-100"
              value={toVersion}
              onChange={(e) => setToVersion(e.target.value)}
            >
              {versions.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </label>

          <div className="flex flex-col justify-end gap-2 lg:col-span-2">
            <button
              type="button"
              className="btn-primary"
              onClick={runCompare}
              disabled={comparing || !fromVersion || !toVersion || fromVersion === toVersion}
            >
              {comparing ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowLeftRight className="h-4 w-4" />}
              Compare
            </button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-white/5 px-5 py-3">
          <button type="button" className="btn-secondary !py-1.5 text-xs" onClick={useDownstreamPin}>
            Use downstream current pin as From
          </button>
          {releasesInfo?.pin_distribution && (
            <span className="text-[11px] text-slate-500">
              Pin distribution:{' '}
              {Object.entries(releasesInfo.pin_distribution)
                .map(([k, v]) => `${k}=${v}`)
                .join(' · ') || 'none yet'}
            </span>
          )}
        </div>
      </div>

      {compareError && (
        <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {compareError}
        </div>
      )}

      {compare && diff && (
        <>
          <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <MetricCard label="Added vars" value={diff.variables.added.length} variant="default" />
            <MetricCard label="Removed vars" value={diff.variables.removed.length} variant="critical" />
            <MetricCard
              label="Made mandatory"
              value={diff.variables.made_mandatory.length}
              variant="warning"
            />
            <MetricCard label="Changed" value={diff.variables.changed.length} />
            <MetricCard
              label="Downstream"
              value={summary?.consumer_count ?? 0}
              sub={`${summary?.critical || 0} critical · ${summary?.on_from_version || 0} on from`}
            />
          </div>

          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <SectionTitle>
              Interface diff · {fromVersion} → {toVersion}
              <span className="ml-2 font-mono text-[10px] normal-case tracking-normal text-slate-500">
                ({compare.from_source_kind} / {compare.to_source_kind})
              </span>
            </SectionTitle>
            <div className="flex gap-2">
              <button type="button" className="btn-secondary !py-1.5 text-xs" onClick={copySummary}>
                <Copy className="h-3.5 w-3.5" />
                {copyNote || 'Copy summary'}
              </button>
              <Link
                to={`/impact/${encodeURIComponent(moduleId)}`}
                className="btn-secondary !py-1.5 text-xs"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Blast Radius
              </Link>
            </div>
          </div>

          <div className="mb-8 grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
            <DiffPanel title="Added" count={diff.variables.added.length} tone="ok" empty="No new variables">
              {diff.variables.added.map((v) => (
                <VarRow
                  key={v.name}
                  name={v.name}
                  detail={v.description}
                  meta={`${v.type || '?'} · default ${formatDefault(v.default)}`}
                />
              ))}
            </DiffPanel>
            <DiffPanel title="Removed" count={diff.variables.removed.length} tone="danger" empty="No removals">
              {diff.variables.removed.map((v) => (
                <VarRow
                  key={v.name}
                  name={v.name}
                  detail={v.description}
                  meta={`${v.type || '?'} · was ${formatDefault(v.default)}`}
                />
              ))}
            </DiffPanel>
            <DiffPanel
              title="Made mandatory"
              count={diff.variables.made_mandatory.length}
              tone="warn"
              empty="No new required vars"
            >
              {diff.variables.made_mandatory.map((m) => (
                <VarRow
                  key={m.name}
                  name={m.name}
                  detail="Default removed — now required"
                  meta={`was ${formatDefault(m.from.default)} → ${formatDefault(m.to.default)}`}
                />
              ))}
            </DiffPanel>
            <DiffPanel
              title="Changed (type/default)"
              count={diff.variables.changed.length}
              tone="info"
              empty="No type/default/description changes"
            >
              {diff.variables.changed.map((c) => (
                <VarRow
                  key={c.name}
                  name={c.name}
                  detail={c.changes.join(', ')}
                  meta={`${c.from.type || '?'}→${c.to.type || '?'} · ${formatDefault(c.from.default)}→${formatDefault(c.to.default)}`}
                />
              ))}
            </DiffPanel>
          </div>

          {(diff.outputs.added.length > 0 || diff.outputs.removed.length > 0) && (
            <div className="card mb-8">
              <div className="card-header">
                <h3 className="text-sm font-semibold">Outputs</h3>
              </div>
              <div className="card-body grid gap-4 md:grid-cols-2 text-sm">
                <div>
                  <div className="mb-2 text-xs text-slate-500">Added</div>
                  {diff.outputs.added.length ? (
                    <ul className="space-y-1 font-mono text-xs text-emerald-300">
                      {diff.outputs.added.map((o) => (
                        <li key={o.name}>+ {o.name}</li>
                      ))}
                    </ul>
                  ) : (
                    <span className="text-xs text-slate-500">—</span>
                  )}
                </div>
                <div>
                  <div className="mb-2 text-xs text-slate-500">Removed</div>
                  {diff.outputs.removed.length ? (
                    <ul className="space-y-1 font-mono text-xs text-red-300">
                      {diff.outputs.removed.map((o) => (
                        <li key={o.name}>− {o.name}</li>
                      ))}
                    </ul>
                  ) : (
                    <span className="text-xs text-slate-500">—</span>
                  )}
                </div>
              </div>
            </div>
          )}

          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <SectionTitle>Downstream impact</SectionTitle>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn-secondary !py-1.5 text-xs" onClick={selectImpacted}>
                Select impacted
              </button>
              <button
                type="button"
                className="btn-primary !py-1.5 text-xs"
                disabled={raising || selectedRepos.size === 0}
                onClick={() => raisePrs([...selectedRepos])}
              >
                {raising ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <GitPullRequest className="h-3.5 w-3.5" />}
                Raise PR ({selectedRepos.size})
              </button>
            </div>
          </div>

          <div className="card mb-6 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10 text-left text-xs text-slate-500">
                    <th className="px-4 py-3 w-8" />
                    <th className="px-4 py-3">Repo</th>
                    <th className="px-4 py-3">Current pin</th>
                    <th className="px-4 py-3">Stacks</th>
                    <th className="px-4 py-3">Severity</th>
                    <th className="px-4 py-3">Suggested actions</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {(compare.consumers || []).map((c) => (
                    <tr key={c.repo_id} className="table-row align-top">
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={selectedRepos.has(c.repo_id)}
                          onChange={() => toggleRepo(c.repo_id)}
                          disabled={c.severity === 'none'}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-mono text-xs text-slate-200">{c.github_full_name || c.repo_id}</div>
                        <div className="text-[10px] text-slate-500">{c.repo_id}</div>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-brand-400">{c.current_pin}</td>
                      <td className="px-4 py-3 text-xs">{c.stack_count}</td>
                      <td className="px-4 py-3">
                        <span className={severityBadge(c.severity)}>{c.severity}</span>
                      </td>
                      <td className="px-4 py-3">
                        <ul className="list-inside list-disc text-[11px] text-slate-400">
                          {(c.suggested_actions || []).slice(0, 3).map((a) => (
                            <li key={a}>{a}</li>
                          ))}
                        </ul>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="flex flex-col gap-1 items-end">
                          <Link
                            to={`/impact/${encodeURIComponent(moduleId)}`}
                            className="text-[11px] text-brand-400 hover:underline"
                          >
                            Blast radius →
                          </Link>
                          <button
                            type="button"
                            className="text-[11px] text-slate-400 hover:text-white"
                            disabled={raising || c.severity === 'none'}
                            onClick={() => raisePrs([c.repo_id])}
                          >
                            Raise PR
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!compare.consumers?.length && (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-sm text-slate-500">
                        No downstream consumers matched this module source yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {prStatus && (
            <div className="card">
              <div className="card-header">
                <h3 className="text-sm font-semibold">Raise PR — AI recommendations & approval</h3>
              </div>
              <div className="card-body space-y-4 text-sm">
                {prStatus.error ? (
                  <p className="text-red-300">{prStatus.error}</p>
                ) : (
                  (prStatus.results || [prStatus]).map((r) => (
                    <AiRecommendationPanel
                      key={r.id || r.repo_id}
                      request={r}
                      approvers={approvers}
                      onUpdated={updatePrResult}
                    />
                  ))
                )}
              </div>
            </div>
          )}
        </>
      )}

      {!compare && !compareError && (
        <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.02] px-6 py-16 text-center">
          <ArrowLeftRight className="mx-auto mb-3 h-8 w-8 text-slate-600" />
          <p className="text-sm text-slate-400">
            Select a module and two releases, then Compare to see variable/output diffs and downstream impact.
          </p>
          <p className="mt-2 text-xs text-slate-600">
            Contracts load from <span className="font-mono">module_release_contracts</span> (seeded) with live scan
            fallback when available.
          </p>
        </div>
      )}
    </PageShell>
  );
}
