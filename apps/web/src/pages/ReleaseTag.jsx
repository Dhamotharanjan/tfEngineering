import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import Header from '../components/Header';
import { PageShell } from '../components/ui';
import { api } from '../api/client';

function ParamTable({ title, rows, empty }) {
  if (!rows?.length) {
    return (
      <div className="card p-4">
        <h4 className="mb-2 text-sm font-semibold text-white">{title}</h4>
        <p className="text-xs text-slate-500">{empty || 'None'}</p>
      </div>
    );
  }
  return (
    <div className="card overflow-hidden">
      <div className="card-header">
        <h4 className="text-sm font-semibold text-white">
          {title} ({rows.length})
        </h4>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-white/10 text-left text-xs text-slate-500">
            <th className="px-4 py-2">Name</th>
            <th className="px-4 py-2">Detail</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.name || r.id || i} className="table-row">
              <td className="px-4 py-2 font-mono text-xs text-brand-300">{r.name || r.type || '—'}</td>
              <td className="px-4 py-2 text-xs text-slate-400">
                {r.detail ||
                  r.description ||
                  (r.changes ? `changed: ${r.changes.join(', ')}` : null) ||
                  (r.type ? `type=${r.type}` : '—')}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function ReleaseTagPage() {
  const { tagId } = useParams();
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [chatBusy, setChatBusy] = useState(false);
  const [chatLog, setChatLog] = useState([]);
  const [message, setMessage] = useState(null);

  async function loadReport() {
    setLoading(true);
    try {
      const data = await api.impactReportLatest();
      setReport(data?.id ? data : null);
    } catch {
      setReport(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadReport();
  }, [tagId]);

  async function triggerImpact() {
    setTriggering(true);
    setMessage(null);
    try {
      await api.triggerImpact({
        upstream_repo_id: 'upstream-core-network-modules',
        from_version: 'v2.4.2',
        to_version: tagId?.startsWith('v') ? tagId : 'v3.0.0',
      });
      setMessage('Impact analysis queued — refreshing…');
      setTimeout(loadReport, 2500);
    } catch (e) {
      setMessage(e.message || 'Trigger failed');
    } finally {
      setTriggering(false);
    }
  }

  async function sendChat(e) {
    e.preventDefault();
    if (!report?.id || !chatInput.trim()) return;
    const q = chatInput.trim();
    setChatInput('');
    setChatLog((prev) => [...prev, { role: 'user', content: q }]);
    setChatBusy(true);
    try {
      const res = await api.impactReportChat(report.id, { message: q });
      setChatLog((prev) => [...prev, { role: 'assistant', content: res.content || JSON.stringify(res) }]);
    } catch (err) {
      setChatLog((prev) => [...prev, { role: 'assistant', content: err.message || 'Chat failed' }]);
    } finally {
      setChatBusy(false);
    }
  }

  const diff = report?.impact_report?.contract_diff?.variables || {};
  const summary = report?.impact_report?.contract_diff?.summary || {};
  const downstream = report?.downstream || [];

  const madeMandatory = useMemo(
    () => (diff.made_mandatory || []).map((m) => ({ name: m.name, detail: 'now required (no default)' })),
    [diff.made_mandatory],
  );

  return (
    <PageShell
      header={
        <Header
          title="Release Tag Impact"
          subtitle="Thorough report: contract params · mandatory · downstream file/dir"
          actions={
            <div className="flex items-center gap-2">
              {report?.breaking && (
                <Link to={report.tree_path || `/dependencies?impact=${report.id}`} className="btn-secondary text-xs">
                  View on Dependency Tree
                </Link>
              )}
              <button type="button" className="btn-primary" onClick={triggerImpact} disabled={triggering}>
                {triggering ? 'Enqueueing…' : 'Trigger P0 Impact Analysis'}
              </button>
            </div>
          }
        />
      }
    >
      {loading && <p className="mb-4 text-sm text-slate-500">Loading impact report…</p>}
      {message && <p className="mb-4 text-xs text-brand-300">{message}</p>}

      {!report && !loading && (
        <div className="card mb-6 p-6 text-sm text-slate-400">
          No live impact report yet. Trigger analysis for a subscribed module source (e.g. VPC v2.4.2 → v3.0.0).
        </div>
      )}

      {report && (
        <>
          <div className="card mb-6">
            <div className="card-body grid gap-4 md:grid-cols-2 lg:grid-cols-5">
              <div>
                <div className="text-xs text-slate-500">Upstream</div>
                <div className="font-mono text-sm text-brand-400">{report.upstream_module}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Version</div>
                <div className="font-mono text-sm">
                  {report.from_version} → {report.to_version}
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Downstream</div>
                <div className="text-sm">{downstream.length}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Breaking</div>
                <span className={report.breaking ? 'badge-critical' : 'badge-success'}>
                  {report.breaking ? 'yes' : 'no'}
                </span>
              </div>
              <div>
                <div className="text-xs text-slate-500">Contract summary</div>
                <div className="text-[11px] text-slate-400">
                  +{summary.added || 0} / −{summary.removed || 0} / mand {summary.made_mandatory || 0}
                </div>
              </div>
            </div>
          </div>

          {(report.impact_report?.release_notes || report.impact_report?.release_name) && (
            <div className="card mb-6 p-4">
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-white">Release notes</h3>
                {report.impact_report?.tag && (
                  <span className="font-mono text-[10px] text-slate-500">{report.impact_report.tag}</span>
                )}
              </div>
              {report.impact_report?.release_name && (
                <div className="mb-2 text-sm text-brand-300">{report.impact_report.release_name}</div>
              )}
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-black/30 p-3 font-mono text-[11px] text-slate-300">
                {report.impact_report.release_notes || '(no body)'}
              </pre>
            </div>
          )}

          <div className="mb-6 grid gap-4 lg:grid-cols-2">
            <ParamTable title="Removed variables" rows={diff.removed} />
            <ParamTable title="Made mandatory" rows={madeMandatory} />
            <ParamTable title="Added variables" rows={diff.added} />
            <ParamTable
              title="Changed variables"
              rows={(diff.changed || []).map((c) => ({
                name: c.name,
                changes: c.changes || [],
                detail: (c.changes || []).join(', '),
              }))}
            />
          </div>

          <div className="card mb-6 overflow-hidden">
            <div className="card-header flex items-center justify-between">
              <h3 className="font-semibold">Downstream detail ({downstream.length})</h3>
              <span className="text-[10px] text-slate-500">Email alerts coming soon</span>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 text-left text-xs text-slate-500">
                  <th className="px-4 py-3">Repo</th>
                  <th className="px-4 py-3">Strategy</th>
                  <th className="px-4 py-3">Version gap</th>
                  <th className="px-4 py-3">Breaking</th>
                  <th className="px-4 py-3">Files / directories</th>
                </tr>
              </thead>
              <tbody>
                {downstream.map((row) => (
                  <tr key={row.id || row.downstream_repo} className="table-row align-top">
                    <td className="px-4 py-3 font-mono text-xs">{row.downstream_repo}</td>
                    <td className="px-4 py-3 text-xs">{row.strategy}</td>
                    <td className="px-4 py-3 text-xs">{row.version_gap || '—'}</td>
                    <td className="px-4 py-3">
                      {(row.breaking_changes || []).length ? (
                        <ul className="space-y-0.5">
                          {(row.breaking_changes || []).slice(0, 4).map((b, i) => (
                            <li key={i} className="badge-critical text-[9px]">
                              {b.type}
                              {b.name ? `:${b.name}` : ''}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <span className="badge-success text-[9px]">none</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <ul className="space-y-1">
                        {(row.locations || []).length === 0 && (
                          <li className="text-xs text-slate-500">No module_references yet</li>
                        )}
                        {(row.locations || []).map((loc, i) => (
                          <li key={i} className="font-mono text-[10px] text-slate-400">
                            <span className="text-slate-300">{loc.directory || '—'}</span>
                            {' / '}
                            {loc.file || loc.stack_file || '—'}
                            {loc.line ? `:${loc.line}` : ''}
                          </li>
                        ))}
                      </ul>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card p-4">
            <h3 className="mb-2 font-semibold text-white">Ask about this impact</h3>
            <p className="mb-3 text-xs text-slate-500">
              Grounded on the impact report (params + downstream locations). Email delivery coming soon.
            </p>
            <div className="mb-3 max-h-48 space-y-2 overflow-y-auto">
              {chatLog.map((m, i) => (
                <div
                  key={i}
                  className={`rounded-md px-3 py-2 text-xs ${
                    m.role === 'user' ? 'bg-brand-500/10 text-brand-100' : 'bg-white/5 text-slate-300'
                  }`}
                >
                  <div className="mb-0.5 text-[10px] uppercase text-slate-500">{m.role}</div>
                  <div className="whitespace-pre-wrap">{m.content}</div>
                </div>
              ))}
            </div>
            <form onSubmit={sendChat} className="flex gap-2">
              <input
                className="input flex-1 text-sm"
                placeholder="How do I implement this upgrade? What breaks?"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                disabled={chatBusy}
              />
              <button type="submit" className="btn-primary text-xs" disabled={chatBusy || !chatInput.trim()}>
                {chatBusy ? '…' : 'Ask'}
              </button>
            </form>
          </div>
        </>
      )}
    </PageShell>
  );
}
