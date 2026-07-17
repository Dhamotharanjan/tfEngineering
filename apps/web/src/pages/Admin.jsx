import { useEffect, useState } from 'react';
import Header from '../components/Header';
import { PageShell, SectionTitle } from '../components/ui';
import { api } from '../api/client';

const STORE_LABELS = {
  neo4j: 'Neo4j graph',
  postgres: 'PostgreSQL',
  postgresql: 'PostgreSQL',
  milvus: 'Milvus (iac_patterns)',
  redis: 'Redis job queue',
  artifacts: 'Worker artifacts',
  ai: 'AI / Milvus',
};

function formatStoreLabel(key) {
  return STORE_LABELS[key] || key.replace(/_/g, ' ');
}

function formatStoreDetail(detail) {
  if (typeof detail !== 'object' || detail === null) return String(detail);
  const parts = [detail.status === 'ok' ? 'cleared' : 'error'];
  if (detail.count != null) parts.push(String(detail.count));
  if (detail.detail) parts.push(String(detail.detail));
  return parts.join(' · ');
}

function storeDetailClass(detail) {
  if (typeof detail === 'object' && detail !== null && detail.status === 'error') {
    return 'text-red-300';
  }
  return 'text-emerald-300';
}

function ResetConfirmModal({ open, onClose, onConfirm, loading }) {
  const [confirmText, setConfirmText] = useState('');
  const canConfirm = confirmText === 'RESET' && !loading;

  useEffect(() => {
    if (!open) setConfirmText('');
  }, [open]);

  if (!open) return null;

  function handleClose() {
    if (loading) return;
    setConfirmText('');
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/60"
        aria-label="Close dialog"
        onClick={handleClose}
      />
      <div className="relative w-full max-w-md card ring-1 ring-red-500/30">
        <div className="card-header">
          <h3 className="font-semibold text-white">Erase scanned &amp; learned test data</h3>
          <p className="mt-1 text-sm text-slate-400">
            This removes graph nodes, scan history, embeddings, queued jobs, and local artifacts.
            Subscription definitions are preserved.
          </p>
        </div>
        <div className="card-body space-y-4">
          <div>
            <label htmlFor="reset-confirm" className="block text-sm text-slate-300">
              Type <span className="font-mono font-semibold text-red-300">RESET</span> to confirm
            </label>
            <input
              id="reset-confirm"
              type="text"
              className="mt-2 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-red-500/50 focus:outline-none focus:ring-1 focus:ring-red-500/30"
              placeholder="RESET"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              autoComplete="off"
              disabled={loading}
            />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={handleClose} disabled={loading}>
              Cancel
            </button>
            <button
              type="button"
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-40"
              disabled={!canConfirm}
              onClick={() => onConfirm()}
            >
              {loading ? 'Erasing…' : 'Erase test data'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Admin() {
  const [modalOpen, setModalOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState(null);
  const [resetResult, setResetResult] = useState(null);

  async function handleReset() {
    setResetting(true);
    setResetError(null);
    setResetResult(null);
    try {
      const result = await api.resetTestData();
      setResetResult(result);
      setModalOpen(false);
    } catch (e) {
      setResetError(e.message || 'Reset failed');
    } finally {
      setResetting(false);
    }
  }

  const cleared = resetResult?.cleared;

  return (
    <PageShell
      header={
        <Header
          title="Admin & Integrations"
          subtitle="Connect GitHub Enterprise, AWS read-only roles, OIDC SSO"
        />
      }
    >
      <div className="grid gap-6 lg:grid-cols-2">
        {[
          { name: 'GitHub Enterprise', status: 'Connected', detail: 'acme-ghe.internal · 47 repos discovered' },
          { name: 'AWS Organizations', status: 'Connected', detail: '4 accounts · read-only IAM role' },
          { name: 'Cost Explorer / CUR', status: 'Connected', detail: 'Daily sync · last 4h ago' },
          { name: 'OIDC SSO (Okta)', status: 'Configured', detail: 'RBAC: Admin, Engineer, Viewer, Auditor' },
          { name: 'Neo4j Graph', status: 'Healthy', detail: 'bolt://neo4j:7687 · 12.4K nodes' },
          { name: 'PostgreSQL', status: 'Healthy', detail: 'tfengineering · 47 subscriptions' },
        ].map((item) => (
          <div key={item.name} className="card p-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-white">{item.name}</h3>
              <span className="badge-success">{item.status}</span>
            </div>
            <p className="mt-2 text-sm text-slate-400">{item.detail}</p>
          </div>
        ))}
      </div>

      <div className="mt-10">
        <SectionTitle>Danger zone</SectionTitle>
        <div className="card ring-1 ring-red-500/30">
          <div className="card-body">
            <h3 className="font-semibold text-white">Erase scanned &amp; learned test data</h3>
            <p className="mt-2 max-w-2xl text-sm text-slate-400">
              Wipe Neo4j graph data, PostgreSQL scan results, Milvus embeddings, the Redis job queue,
              and worker artifacts. Repo subscription definitions from config are not removed.
            </p>

            {resetError && (
              <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                {resetError}
              </div>
            )}

            {cleared && (
              <div className="mt-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3">
                <p className="text-sm font-medium text-emerald-300">
                  Reset complete{resetResult?.status ? ` · ${resetResult.status}` : ''}
                </p>
                <ul className="mt-2 space-y-1 text-sm text-slate-300">
                  {Object.entries(cleared).map(([store, detail]) => (
                    <li key={store} className="flex items-start justify-between gap-4">
                      <span>{formatStoreLabel(store)}</span>
                      <span className={`text-right text-xs ${storeDetailClass(detail)}`}>
                        {formatStoreDetail(detail)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <button
              type="button"
              className="mt-4 inline-flex items-center justify-center gap-2 rounded-lg border border-red-500/40 bg-red-600/20 px-4 py-2 text-sm font-semibold text-red-300 transition hover:bg-red-600/30"
              onClick={() => {
                setResetError(null);
                setModalOpen(true);
              }}
            >
              Erase scanned &amp; learned test data
            </button>
          </div>
        </div>
      </div>

      <ResetConfirmModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onConfirm={handleReset}
        loading={resetting}
      />
    </PageShell>
  );
}
