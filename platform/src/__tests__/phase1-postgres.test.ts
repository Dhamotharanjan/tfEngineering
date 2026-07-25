/**
 * Phase 1 Postgres adapter tests — fake SqlExecutor (no live DB).
 * Covers dual watermark isolation, impact_reports round-trip, and scenario-8
 * staleness against store-backed watermarks.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ImpactEngine,
  ImpactClass,
  JobIntent,
  MemoryContractStore,
  MemoryGraphReader,
  MemoryGraphWriter,
  MemoryJobEnqueuer,
  MemoryImpactReportStore,
  MemoryNotifier,
  MemoryPatternStore,
  MemorySubscriptionReader,
  PostgresImpactReportStore,
  PostgresWatermarkStore,
  TemplateNarrator,
  detectStaleness,
  type ImpactReport,
  type SqlExecutor,
} from '../index.ts';
import { resolveConfig } from '../config/loader.ts';
import {
  FAKE,
  contract,
  consumerSub,
  moduleSub,
  pinBumpFile,
} from './harness.ts';

type Row = Record<string, unknown>;

/** Minimal in-memory fake that records SQL + params for assertions. */
class FakeSql implements SqlExecutor {
  readonly calls: Array<{ sql: string; params?: unknown[] }> = [];
  subscriptions = new Map<string, Row>();
  reports = new Map<string, Row>();

  async query<T = any>(sql: string, params?: unknown[]): Promise<{ rows: T[]; rowCount?: number }> {
    this.calls.push({ sql, params });
    const q = sql.replace(/\s+/g, ' ').trim().toLowerCase();

    if (q.startsWith('select') && q.includes('from subscriptions')) {
      const id = params?.[0] as string;
      const row = this.subscriptions.get(id);
      if (!row) return { rows: [], rowCount: 0 };
      // Mirror SELECT aliases used by PostgresWatermarkStore.get.
      return {
        rows: [
          {
            repo_id: row.repo_id ?? row.id ?? id,
            indexed_sha: row.indexed_sha ?? row.last_scanned_sha ?? null,
            last_event_sha: row.last_event_sha ?? null,
            indexed_at: row.indexed_at ?? null,
          },
        ] as T[],
        rowCount: 1,
      };
    }

    if (q.startsWith('update subscriptions') && q.includes('last_event_sha') && !q.includes('last_scanned_sha')) {
      const [id, sha] = params as [string, string];
      const cur = this.subscriptions.get(id) ?? { id, repo_id: id };
      cur.last_event_sha = sha;
      this.subscriptions.set(id, cur);
      return { rows: [], rowCount: 1 };
    }

    if (q.startsWith('update subscriptions') && q.includes('last_scanned_sha')) {
      const [id, sha] = params as [string, string];
      const cur = this.subscriptions.get(id) ?? { id, repo_id: id };
      cur.last_scanned_sha = sha;
      cur.indexed_sha = sha;
      cur.indexed_at = new Date().toISOString();
      this.subscriptions.set(id, cur);
      return { rows: [], rowCount: 1 };
    }

    if (q.startsWith('insert into impact_reports')) {
      const reportId = params?.[0] as string;
      const reportJson = params?.[19];
      const parsed = typeof reportJson === 'string' ? JSON.parse(reportJson) : reportJson;
      this.reports.set(reportId, {
        report_id: reportId,
        repo_id: params?.[1],
        report: parsed,
      });
      return { rows: [], rowCount: 1 };
    }

    if (q.startsWith('select') && q.includes('from impact_reports')) {
      const id = params?.[0] as string;
      const row = this.reports.get(id);
      return { rows: (row ? [row] : []) as T[], rowCount: row ? 1 : 0 };
    }

    return { rows: [], rowCount: 0 };
  }
}

test('setLastEventSha writes last_event_sha and never last_scanned_sha', async () => {
  const sql = new FakeSql();
  sql.subscriptions.set('mod-a', {
    id: 'mod-a',
    repo_id: 'mod-a',
    indexed_sha: 'sha-indexed',
    last_scanned_sha: 'sha-indexed',
    last_event_sha: null,
    indexed_at: '2026-01-01T00:00:00.000Z',
  });
  const store = new PostgresWatermarkStore(sql);

  await store.setLastEventSha('mod-a', 'sha-hot-event');

  const update = sql.calls.find((c) => /update subscriptions/i.test(c.sql) && /last_event_sha/i.test(c.sql));
  assert.ok(update, 'expected UPDATE for last_event_sha');
  assert.ok(!/last_scanned_sha/i.test(update!.sql), 'HOT update must not reference last_scanned_sha');
  assert.ok(!/indexed_at/i.test(update!.sql), 'HOT update must not touch indexed_at');
  assert.equal(sql.subscriptions.get('mod-a')!.last_scanned_sha, 'sha-indexed');
  assert.equal(sql.subscriptions.get('mod-a')!.last_event_sha, 'sha-hot-event');

  const wm = await store.get('mod-a');
  assert.equal(wm?.indexedSha, 'sha-indexed');
  assert.equal(wm?.lastEventSha, 'sha-hot-event');
  assert.equal(wm?.indexedAt, '2026-01-01T00:00:00.000Z');
});

test('impact reports persist to impact_reports and read back by report_id', async () => {
  const sql = new FakeSql();
  const store = new PostgresImpactReportStore(sql);
  const report: ImpactReport = {
    reportId: 'rep-1',
    intent: JobIntent.PR_IMPACT_QUERY,
    moduleRepoId: 'mod-a',
    fromVersion: '1.0.0',
    toVersion: '1.1.0',
    prNumber: 42,
    headSha: 'abc',
    impactExists: true,
    silent: false,
    consumers: [],
    patternChecks: [],
    verdict: 'PASS',
    refreshEnqueued: [],
    generatedAt: new Date().toISOString(),
  };

  await store.save(report);
  const insert = sql.calls.find((c) => /insert into impact_reports/i.test(c.sql));
  assert.ok(insert);
  assert.equal(insert!.params?.[0], 'rep-1');

  const got = await store.get('rep-1');
  assert.ok(got);
  assert.equal(got!.reportId, 'rep-1');
  assert.equal(got!.moduleRepoId, 'mod-a');
  assert.equal(got!.verdict, 'PASS');
});

test('staleness uses real indexed_sha/indexed_at and yields UNKNOWN + WARM without graph write', async () => {
  const sql = new FakeSql();
  sql.subscriptions.set(FAKE.moduleId, {
    id: FAKE.moduleId,
    repo_id: FAKE.moduleId,
    indexed_sha: 'sha-old',
    last_scanned_sha: 'sha-old',
    last_event_sha: 'sha-new',
    indexed_at: '2026-06-01T12:00:00.000Z',
  });
  const watermarks = new PostgresWatermarkStore(sql);
  const wm = await watermarks.get(FAKE.moduleId);
  assert.equal(wm?.indexedSha, 'sha-old');
  assert.equal(wm?.indexedAt, '2026-06-01T12:00:00.000Z');
  assert.equal(wm?.lastEventSha, 'sha-new');

  const stale = detectStaleness({
    moduleWatermark: wm,
    fromContract: contract(FAKE.vFrom, [{ name: 'required_a' }]),
    toContract: contract(FAKE.vTo, [{ name: 'required_a' }]),
  });
  assert.equal(stale.stale, true);
  assert.equal(stale.reason, 'graph_behind_event');

  const subscriptions = new MemorySubscriptionReader([moduleSub(), consumerSub()]);
  const contracts = new MemoryContractStore();
  await contracts.put(contract(FAKE.vFrom, [{ name: 'required_a' }]));
  await contracts.put(contract(FAKE.vTo, [{ name: 'required_a' }]));
  const graph = new MemoryGraphReader();
  graph.setConsumers(FAKE.moduleId, [
    {
      consumerRepoId: FAKE.consumerId,
      currentPin: FAKE.vFrom,
      providedInputs: ['required_a'],
      locations: [{ file: 'main.tf' }],
    },
  ]);
  const jobs = new MemoryJobEnqueuer();
  const graphWriter = new MemoryGraphWriter();
  const reports = new MemoryImpactReportStore();

  const engine = new ImpactEngine({
    graph,
    subscriptions,
    contracts,
    watermarks,
    patterns: new MemoryPatternStore(),
    reports,
    jobs,
    notifier: new MemoryNotifier(),
    narrator: new TemplateNarrator(),
    config: resolveConfig({}),
  });

  const report = await engine.runHotQuery({
    intent: JobIntent.PR_IMPACT_QUERY,
    repoId: FAKE.consumerId,
    headSha: FAKE.shaHead,
    files: [pinBumpFile(FAKE.vFrom, FAKE.vTo)],
    prAuthor: 'octo-dev',
  });

  assert.equal(report.consumers[0]?.class, ImpactClass.UNKNOWN);
  assert.equal(report.consumers[0]?.evidence.staleness?.stale, true);
  assert.ok(jobs.jobs.some((j) => j.intent === JobIntent.WARM_INCREMENTAL && j.repoId === FAKE.moduleId));
  assert.ok(report.refreshEnqueued.length >= 1);
  assert.equal(graphWriter.writes.length, 0);

  const hotUpdates = sql.calls.filter(
    (c) => /update subscriptions/i.test(c.sql) && /last_event_sha/i.test(c.sql),
  );
  assert.ok(hotUpdates.length >= 1);
  for (const u of hotUpdates) {
    assert.ok(!/last_scanned_sha/i.test(u.sql));
  }
  assert.equal(sql.subscriptions.get(FAKE.moduleId)!.last_scanned_sha, 'sha-old');
});
