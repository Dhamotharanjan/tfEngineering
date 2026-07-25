/**
 * Phase 1 dual-watermark + impact_reports contract (no Nest bootstrap / no live DB).
 * Run: node --test src/platform/job-mapping.test.cjs src/platform/phase1-stores.test.cjs
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  PostgresWatermarkStore,
  PostgresImpactReportStore,
  JobIntent,
  detectStaleness,
} = require('@infragraph/platform');

class FakeSql {
  constructor() {
    this.calls = [];
    this.subscriptions = new Map();
    this.reports = new Map();
  }

  async query(sql, params) {
    this.calls.push({ sql, params });
    const q = sql.replace(/\s+/g, ' ').trim().toLowerCase();

    if (q.startsWith('select') && q.includes('from subscriptions')) {
      const id = params[0];
      const row = this.subscriptions.get(id);
      if (!row) return { rows: [], rowCount: 0 };
      return {
        rows: [
          {
            repo_id: row.repo_id || row.id || id,
            indexed_sha: row.indexed_sha ?? row.last_scanned_sha ?? null,
            last_event_sha: row.last_event_sha ?? null,
            indexed_at: row.indexed_at ?? null,
          },
        ],
        rowCount: 1,
      };
    }

    if (q.startsWith('update subscriptions') && q.includes('last_event_sha') && !q.includes('last_scanned_sha')) {
      const [id, sha] = params;
      const cur = this.subscriptions.get(id) || { id, repo_id: id };
      cur.last_event_sha = sha;
      this.subscriptions.set(id, cur);
      return { rows: [], rowCount: 1 };
    }

    if (q.startsWith('insert into impact_reports')) {
      const reportId = params[0];
      const reportJson = params[19];
      const parsed = typeof reportJson === 'string' ? JSON.parse(reportJson) : reportJson;
      this.reports.set(reportId, { report_id: reportId, report: parsed });
      return { rows: [], rowCount: 1 };
    }

    if (q.startsWith('select') && q.includes('from impact_reports')) {
      const row = this.reports.get(params[0]);
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }

    return { rows: [], rowCount: 0 };
  }
}

describe('Phase 1 PostgresWatermarkStore (HOT isolation)', () => {
  it('setLastEventSha writes last_event_sha and never last_scanned_sha', async () => {
    const sql = new FakeSql();
    sql.subscriptions.set('repo-a', {
      id: 'repo-a',
      last_scanned_sha: 'sha-indexed',
      indexed_sha: 'sha-indexed',
      last_event_sha: null,
      indexed_at: '2026-01-01T00:00:00.000Z',
    });
    const store = new PostgresWatermarkStore(sql);
    await store.setLastEventSha('repo-a', 'sha-hot');

    const update = sql.calls.find((c) => /last_event_sha/i.test(c.sql) && /update/i.test(c.sql));
    assert.ok(update);
    assert.ok(!/last_scanned_sha/i.test(update.sql));
    assert.ok(!/indexed_at\s*=/i.test(update.sql));
    assert.equal(sql.subscriptions.get('repo-a').last_scanned_sha, 'sha-indexed');
    assert.equal(sql.subscriptions.get('repo-a').last_event_sha, 'sha-hot');

    const wm = await store.get('repo-a');
    assert.equal(wm.indexedSha, 'sha-indexed');
    assert.equal(wm.lastEventSha, 'sha-hot');
    assert.equal(wm.indexedAt, '2026-01-01T00:00:00.000Z');
  });
});

describe('Phase 1 PostgresImpactReportStore', () => {
  it('persists to impact_reports and reads back by report_id', async () => {
    const sql = new FakeSql();
    const store = new PostgresImpactReportStore(sql);
    const report = {
      reportId: 'rep-phase1',
      intent: JobIntent.PR_IMPACT_QUERY,
      moduleRepoId: 'repo-a',
      fromVersion: null,
      toVersion: null,
      impactExists: false,
      silent: true,
      consumers: [],
      patternChecks: [],
      verdict: 'PASS',
      refreshEnqueued: [],
      generatedAt: new Date().toISOString(),
    };
    await store.save(report);
    assert.ok(sql.calls.some((c) => /insert into impact_reports/i.test(c.sql)));
    const got = await store.get('rep-phase1');
    assert.equal(got.reportId, 'rep-phase1');
    assert.equal(got.silent, true);
  });
});

describe('Phase 1 staleness against store watermarks', () => {
  it('graph_behind_event when indexed_sha != last_event_sha (indexed_at present)', async () => {
    const sql = new FakeSql();
    sql.subscriptions.set('mod-a', {
      id: 'mod-a',
      last_scanned_sha: 'sha-old',
      indexed_sha: 'sha-old',
      last_event_sha: 'sha-new',
      indexed_at: '2026-06-01T12:00:00.000Z',
    });
    const wm = await new PostgresWatermarkStore(sql).get('mod-a');
    const info = detectStaleness({
      moduleWatermark: wm,
      fromContract: { moduleId: 'mod-a', version: 'a', variables: [], outputs: [] },
      toContract: { moduleId: 'mod-a', version: 'b', variables: [], outputs: [] },
    });
    assert.equal(info.stale, true);
    assert.equal(info.reason, 'graph_behind_event');
  });
});
