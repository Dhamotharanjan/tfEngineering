import { Fragment, useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronRight, RefreshCw, Radar } from 'lucide-react';
import Header from '../components/Header';
import { PageShell } from '../components/ui';
import { api } from '../api/client';

function statusBadge(status) {
  if (status === 'completed' || status === 'success') return 'badge-success';
  if (status === 'running' || status === 'queued') return 'badge-warning';
  if (status === 'failed') return 'badge-critical';
  return 'badge-neutral';
}

function fmtTime(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function shortSha(sha) {
  if (!sha) return '—';
  return String(sha).slice(0, 8);
}

function fmtDuration(ms) {
  if (ms == null || Number.isNaN(ms)) return '—';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms / 60_000)}m`;
}

/** Expected pipeline stages by job type — used to clarify why some jobs omit parse/enrich. */
const JOB_STAGE_HINTS = {
  full_scan: {
    expected: ['acquisition', 'parse', 'enrich', 'persist', 'graph'],
    note: null,
  },
  incremental_scan: {
    expected: ['acquisition', 'parse', 'enrich', 'persist', 'graph'],
    note: null,
  },
  reconcile_scan: {
    expected: ['acquisition', 'parse', 'enrich', 'persist', 'graph'],
    note: null,
  },
  module_impact_hint: {
    expected: ['impact_hint'],
    note: 'Lightweight follow-up after a module interface change — does not re-run acquisition/parse/enrich. Those stages are on the preceding full/incremental scan for this repo.',
  },
  mandatory_impact_analysis: {
    expected: ['impact'],
    note: 'Impact-only job — does not run the parse/enrich pipeline. Use a full or incremental scan for those stages.',
  },
};

export default function ScannerMonitor() {
  const [overview, setOverview] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expandedJob, setExpandedJob] = useState(null);
  const [runs, setRuns] = useState({});
  const [jobMeta, setJobMeta] = useState({});
  const [reconciling, setReconciling] = useState(false);
  const [message, setMessage] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [ov, j] = await Promise.all([api.scannerOverview(), api.scannerJobs(50)]);
      setOverview(ov);
      setJobs(j || []);
      setError(null);
    } catch (e) {
      setError(e.message || 'Failed to load scanner monitor');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [load]);

  async function toggleRuns(jobId) {
    if (expandedJob === jobId) {
      setExpandedJob(null);
      return;
    }
    setExpandedJob(jobId);
    if (runs[jobId] || jobMeta[jobId]) return;
    try {
      const data = await api.scannerJobRuns(jobId);
      setRuns((prev) => ({ ...prev, [jobId]: data.runs || [] }));
      setJobMeta((prev) => ({
        ...prev,
        [jobId]: {
          error_message: data.error_message || data.job?.error_message || null,
          job: data.job || null,
        },
      }));
    } catch (e) {
      setRuns((prev) => ({ ...prev, [jobId]: [] }));
      setJobMeta((prev) => ({ ...prev, [jobId]: { error_message: e.message } }));
    }
  }

  async function runReconcile() {
    setReconciling(true);
    setMessage(null);
    try {
      const res = await api.scannerReconcile();
      setMessage(`Reconcile queued for ${res.enqueued} subscribed repo(s)`);
      await load();
    } catch (e) {
      setMessage(e.message || 'Reconcile failed');
    } finally {
      setReconciling(false);
    }
  }

  const repos = overview?.repos || [];
  const schedule = overview?.schedule || {};

  return (
    <PageShell
      header={
        <Header
          title="Scanner Monitor"
          subtitle="Subscribed repos only · schedules + scan logs"
          actions={
            <div className="flex items-center gap-2">
              <Link to="/repos" className="btn-secondary text-xs">
                Subscriptions
              </Link>
              <button type="button" className="btn-primary inline-flex items-center gap-1.5" onClick={runReconcile} disabled={reconciling}>
                <RefreshCw className={`h-3.5 w-3.5 ${reconciling ? 'animate-spin' : ''}`} />
                {reconciling ? 'Enqueueing…' : 'Run reconcile now'}
              </button>
            </div>
          }
        />
      }
    >
      {loading && !overview && <p className="mb-4 text-sm text-slate-500">Loading scanner overview…</p>}
      {error && <p className="mb-4 text-xs text-amber-400">{error}</p>}
      {message && <p className="mb-4 text-xs text-brand-300">{message}</p>}

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <div className="card p-4">
          <div className="text-[10px] uppercase tracking-wider text-slate-500">Subscribed repos</div>
          <div className="mt-1 text-2xl font-semibold text-white">{repos.length}</div>
        </div>
        <div className="card p-4">
          <div className="text-[10px] uppercase tracking-wider text-slate-500">Reconcile cron (UTC)</div>
          <div className="mt-1 font-mono text-sm text-brand-300">{schedule.full_reconcile_cron || '—'}</div>
        </div>
        <div className="card p-4">
          <div className="text-[10px] uppercase tracking-wider text-slate-500">Next estimated run</div>
          <div className="mt-1 text-sm text-slate-200">{fmtTime(schedule.next_run_utc)}</div>
        </div>
      </div>

      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
        <Radar className="h-4 w-4 text-brand-400" />
        Schedule board
      </h3>
      <div className="card mb-8 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10 text-left text-xs text-slate-500">
              <th className="px-4 py-3">Repository</th>
              <th className="px-4 py-3">Profile</th>
              <th className="px-4 py-3">Last full</th>
              <th className="px-4 py-3">Last incremental</th>
              <th className="px-4 py-3">SHA</th>
              <th className="px-4 py-3">Next run</th>
              <th className="px-4 py-3">Reconcile</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {repos.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-center text-slate-500">
                  No subscribed repos — enable subscriptions first.
                </td>
              </tr>
            )}
            {repos.map((r) => (
              <tr key={r.id} className="table-row">
                <td className="px-4 py-3">
                  <div className="font-mono text-xs text-brand-300">{r.name}</div>
                  <div className="text-[10px] text-slate-500">{r.role}</div>
                </td>
                <td className="px-4 py-3 text-xs">{r.scan_profile || '—'}</td>
                <td className="px-4 py-3 text-xs text-slate-400">{fmtTime(r.last_full_scan_at)}</td>
                <td className="px-4 py-3 text-xs text-slate-400">{fmtTime(r.last_incremental_at)}</td>
                <td className="px-4 py-3 font-mono text-[10px]">{shortSha(r.last_scanned_sha)}</td>
                <td className="px-4 py-3 text-xs text-slate-400">{r.reconcile_enabled ? fmtTime(r.next_run_utc) : 'disabled'}</td>
                <td className="px-4 py-3">
                  <span className={r.reconcile_enabled ? 'badge-success' : 'badge-neutral'}>
                    {r.reconcile_enabled ? 'on' : 'off'}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <Link to="/repos" className="text-xs text-brand-400 hover:underline">
                    Adhoc scan →
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="border-t border-white/5 px-4 py-2 text-[10px] text-slate-500">
          Remote-first: subscribed repos are scanned via <code className="text-slate-400">github_full_name</code> into an
          ephemeral mirror cache (not a product-owned copy). Private repos need <code className="text-slate-400">GITHUB_TOKEN</code>.
          EOL/FinOps crons are configured in scan-profiles but not yet enforced. Per-repo override:{' '}
          <code className="text-slate-400">triggers_enabled.reconcile_enabled</code>.
        </p>
      </div>

      <h3 className="mb-3 text-sm font-semibold text-white">Live / recent jobs</h3>
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10 text-left text-xs text-slate-500">
              <th className="w-8 px-3 py-3" />
              <th className="px-4 py-3">When</th>
              <th className="px-4 py-3">Job</th>
              <th className="px-4 py-3">Type / mode</th>
              <th className="px-4 py-3">Priority</th>
              <th className="px-4 py-3">Repo</th>
              <th className="px-4 py-3">SHA range</th>
              <th className="px-4 py-3">Files</th>
              <th className="px-4 py-3">Duration</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((j) => {
              const failReason = j.error_message || jobMeta[j.id]?.error_message;
              return (
              <Fragment key={j.id}>
                <tr className="table-row">
                  <td className="px-3 py-3">
                    <button type="button" className="text-slate-400 hover:text-white" onClick={() => toggleRuns(j.id)}>
                      {expandedJob === j.id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-[10px] text-slate-400">
                    <div>{fmtTime(j.started_at || j.created_at)}</div>
                    {j.completed_at && (
                      <div className="text-slate-600">done {fmtTime(j.completed_at)}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono text-[10px]">{j.id}</td>
                  <td className="px-4 py-3">
                    <div className="text-xs">{j.type}</div>
                    <div className="text-[10px] text-slate-500">{j.mode || j.last_stage || '—'}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={j.priority === 'P0' || j.priority === 'P1' ? 'badge-critical' : 'badge-neutral'}>
                      {j.priority}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-[10px]">{j.repo_id || '—'}</td>
                  <td className="px-4 py-3 font-mono text-[10px]">
                    {j.from_sha || j.to_sha ? `${shortSha(j.from_sha)}…${shortSha(j.to_sha)}` : '—'}
                  </td>
                  <td className="px-4 py-3 text-xs">{j.files_touched ?? '—'}</td>
                  <td className="px-4 py-3 text-xs text-slate-400">{fmtDuration(j.duration_ms)}</td>
                  <td className="px-4 py-3">
                    <span className={statusBadge(j.status)}>{j.status}</span>
                    {j.status === 'failed' && failReason && (
                      <div className="mt-1 max-w-[14rem] truncate text-[9px] text-rose-300" title={failReason}>
                        {failReason}
                      </div>
                    )}
                  </td>
                </tr>
                {expandedJob === j.id && (
                  <tr className="border-b border-white/5 bg-white/[0.02]">
                    <td colSpan={10} className="px-6 py-3">
                      <div className="mb-2 grid gap-2 text-[11px] text-slate-400 sm:grid-cols-3">
                        <div>
                          <span className="text-slate-500">Queued </span>
                          {fmtTime(j.created_at)}
                        </div>
                        <div>
                          <span className="text-slate-500">Started </span>
                          {fmtTime(j.started_at || j.created_at)}
                        </div>
                        <div>
                          <span className="text-slate-500">Completed </span>
                          {fmtTime(j.completed_at)}
                        </div>
                      </div>
                      {(failReason || j.error_message) && (
                        <div className="mb-3 rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2">
                          <div className="text-xs font-medium text-rose-200">Failure</div>
                          <pre className="mt-1 whitespace-pre-wrap font-mono text-[10px] text-rose-100">
                            {failReason || j.error_message}
                          </pre>
                        </div>
                      )}
                      <div className="text-xs font-medium text-slate-300">Stage logs</div>
                      {JOB_STAGE_HINTS[j.type]?.note && (
                        <p className="mt-1 text-[11px] text-slate-500">{JOB_STAGE_HINTS[j.type].note}</p>
                      )}
                      {JOB_STAGE_HINTS[j.type]?.expected && (
                        <p className="mt-1 text-[10px] text-slate-600">
                          Expected for {j.type}: {JOB_STAGE_HINTS[j.type].expected.join(' → ')}
                        </p>
                      )}
                      <ul className="mt-2 space-y-1.5">
                        {(runs[j.id] || []).length === 0 && !failReason && !j.error_message && (
                          <li className="text-xs text-slate-500">No scan_runs yet</li>
                        )}
                        {(runs[j.id] || []).length === 0 && (failReason || j.error_message) && (
                          <li className="text-xs text-slate-500">
                            Failed before any stage was recorded (intake/acquisition).
                          </li>
                        )}
                        {(runs[j.id] || []).map((r) => (
                          <li key={r.id || r.stage} className="rounded-md bg-black/20 px-3 py-2 font-mono text-[10px] text-slate-400">
                            <span className="text-slate-200">{r.stage}</span> · {r.status}
                            {r.nodes_written != null || r.edges_written != null
                              ? ` · n=${r.nodes_written ?? 0}/e=${r.edges_written ?? 0}`
                              : ''}
                            {r.duration_ms != null ? ` · ${r.duration_ms}ms` : ''}
                            {r.created_at ? ` · ${fmtTime(r.created_at)}` : ''}
                            {r.details ? (
                              <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap text-[9px] text-slate-500">
                                {typeof r.details === 'string' ? r.details : JSON.stringify(r.details, null, 2)}
                              </pre>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    </td>
                  </tr>
                )}
              </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </PageShell>
  );
}
