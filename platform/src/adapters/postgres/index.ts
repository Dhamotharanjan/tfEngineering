import type {
  SubscriptionReader,
  WatermarkStore,
  ContractStore,
  ImpactReportStore,
  AuditStore,
  AuditEntry,
} from '../../ports/index.ts';
import type { Subscription } from '../../domain/subscription.ts';
import type { Watermark } from '../../domain/watermark.ts';
import type { ModuleContract } from '../../domain/contract.ts';
import type { ImpactReport, ImpactedConsumer } from '../../domain/impact.ts';

// Minimal SQL executor seam. Wire the existing `pg` Pool (see apps/api DbService)
// or the worker's store.Postgres here. Kept as an injected interface so this
// module needs no database driver dependency and tests stay offline.
export interface SqlExecutor {
  query<T = any>(sql: string, params?: unknown[]): Promise<{ rows: T[]; rowCount?: number }>;
}

// Postgres-backed adapters. Table/column names align with config/postgres/schema.sql
// (subscriptions dual watermark + impact_reports + module_release_contracts + audit_log).

export class PostgresSubscriptionReader implements SubscriptionReader {
  private sql: SqlExecutor;
  constructor(sql: SqlExecutor) {
    this.sql = sql;
  }
  async get(repoId: string): Promise<Subscription | null> {
    const res = await this.sql.query(
      `SELECT id, github_full_name, role, subscribed, appsvn, application_label,
              module_sources_watched, compliance_scope, contacts
       FROM subscriptions WHERE id = $1`,
      [repoId],
    );
    return res.rows.length ? mapSubscription(res.rows[0]) : null;
  }
  async resolveByFullName(fullName: string): Promise<Subscription | null> {
    const res = await this.sql.query(
      `SELECT id, github_full_name, role, subscribed, appsvn, application_label,
              module_sources_watched, compliance_scope, contacts
       FROM subscriptions WHERE github_full_name = $1 LIMIT 1`,
      [fullName],
    );
    return res.rows.length ? mapSubscription(res.rows[0]) : null;
  }
  async list(): Promise<Subscription[]> {
    const res = await this.sql.query(
      `SELECT id, github_full_name, role, subscribed, appsvn, application_label,
              module_sources_watched, compliance_scope, contacts
       FROM subscriptions`,
    );
    return res.rows.map(mapSubscription);
  }
}

// Dual watermark. indexed_sha reuses subscriptions.last_scanned_sha (COLD/WARM);
// last_event_sha is HOT-only informational and must never touch last_scanned_sha.
export class PostgresWatermarkStore implements WatermarkStore {
  private sql: SqlExecutor;
  constructor(sql: SqlExecutor) {
    this.sql = sql;
  }
  async get(repoId: string): Promise<Watermark | null> {
    const res = await this.sql.query(
      `SELECT id AS repo_id,
              last_scanned_sha AS indexed_sha,
              last_event_sha,
              indexed_at
       FROM subscriptions WHERE id = $1`,
      [repoId],
    );
    if (!res.rows.length) return null;
    const r = res.rows[0] as any;
    const indexedAt = r.indexed_at ? new Date(r.indexed_at).toISOString() : null;
    return {
      repoId: r.repo_id,
      indexedSha: r.indexed_sha ?? null,
      lastEventSha: r.last_event_sha ?? null,
      indexedAt,
      updatedAt: indexedAt ?? undefined,
    };
  }
  async setIndexedSha(repoId: string, sha: string): Promise<void> {
    // COLD/WARM only — advances authoritative indexed_sha + indexed_at.
    await this.sql.query(
      `UPDATE subscriptions
       SET last_scanned_sha = $2, indexed_at = now(), updated_at = now()
       WHERE id = $1`,
      [repoId, sha],
    );
  }
  async setLastEventSha(repoId: string, sha: string): Promise<void> {
    // HOT only — must NOT touch last_scanned_sha / indexed_at.
    await this.sql.query(
      `UPDATE subscriptions SET last_event_sha = $2, updated_at = now() WHERE id = $1`,
      [repoId, sha],
    );
  }
}

export class PostgresContractStore implements ContractStore {
  private sql: SqlExecutor;
  constructor(sql: SqlExecutor) {
    this.sql = sql;
  }
  async get(moduleId: string, version: string): Promise<ModuleContract | null> {
    const res = await this.sql.query(
      `SELECT module_id, version, module_source, variables, outputs
       FROM module_release_contracts WHERE module_id = $1 AND version = $2`,
      [moduleId, version],
    );
    if (!res.rows.length) return null;
    const r = res.rows[0];
    return {
      moduleId: r.module_id,
      version: r.version,
      moduleSource: r.module_source,
      variables: r.variables || [],
      outputs: r.outputs || [],
    };
  }
  async put(contract: ModuleContract): Promise<void> {
    await this.sql.query(
      `INSERT INTO module_release_contracts (id, module_id, module_source, version, variables, outputs, source_kind)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,'platform')
       ON CONFLICT (module_id, version) DO UPDATE SET
         variables = EXCLUDED.variables, outputs = EXCLUDED.outputs`,
      [
        `${contract.moduleId}@${contract.version}`,
        contract.moduleId,
        contract.moduleSource ?? null,
        contract.version,
        JSON.stringify(contract.variables),
        JSON.stringify(contract.outputs),
      ],
    );
  }
}

export class PostgresImpactReportStore implements ImpactReportStore {
  private sql: SqlExecutor;
  constructor(sql: SqlExecutor) {
    this.sql = sql;
  }
  async save(report: ImpactReport): Promise<void> {
    const summary = classificationSummary(report.consumers ?? []);
    const evidence = (report.consumers ?? []).map((c) => c.evidence);
    await this.sql.query(
      `INSERT INTO impact_reports (
         report_id, repo_id, intent, event_kind, path,
         pr_number, tag, from_version, to_version, base_sha, head_sha,
         verdict, silent, impact_exists, consumer_count,
         consumers, evidence, classification_summary, pattern_checks, refresh_enqueued, report
       ) VALUES (
         $1,$2,$3,$4,'HOT',
         $5,$6,$7,$8,$9,$10,
         $11,$12,$13,$14,
         $15::jsonb,$16::jsonb,$17::jsonb,$18::jsonb,$19::jsonb,$20::jsonb
       )
       ON CONFLICT (report_id) DO UPDATE SET
         verdict = EXCLUDED.verdict,
         silent = EXCLUDED.silent,
         impact_exists = EXCLUDED.impact_exists,
         consumer_count = EXCLUDED.consumer_count,
         consumers = EXCLUDED.consumers,
         evidence = EXCLUDED.evidence,
         classification_summary = EXCLUDED.classification_summary,
         pattern_checks = EXCLUDED.pattern_checks,
         refresh_enqueued = EXCLUDED.refresh_enqueued,
         report = EXCLUDED.report`,
      [
        report.reportId,
        report.moduleRepoId,
        report.intent,
        report.intent,
        report.prNumber ?? null,
        report.toVersion ?? null,
        report.fromVersion ?? null,
        report.toVersion ?? null,
        null,
        report.headSha ?? null,
        report.verdict,
        report.silent,
        report.impactExists,
        report.consumers?.length ?? 0,
        JSON.stringify(report.consumers ?? []),
        JSON.stringify(evidence),
        JSON.stringify(summary),
        JSON.stringify(report.patternChecks ?? []),
        JSON.stringify(report.refreshEnqueued ?? []),
        JSON.stringify(report),
      ],
    );
  }
  async get(reportId: string): Promise<ImpactReport | null> {
    const res = await this.sql.query(`SELECT report FROM impact_reports WHERE report_id = $1`, [reportId]);
    if (!res.rows.length) return null;
    const raw = res.rows[0].report;
    return (typeof raw === 'string' ? JSON.parse(raw) : raw) as ImpactReport;
  }
}

export class PostgresAuditStore implements AuditStore {
  private sql: SqlExecutor;
  constructor(sql: SqlExecutor) {
    this.sql = sql;
  }
  async record(entry: AuditEntry): Promise<void> {
    await this.sql.query(
      `INSERT INTO audit_log (actor, action, target, details) VALUES ($1,$2,$3,$4::jsonb)`,
      [entry.actor, entry.action, entry.target, JSON.stringify({ reason: entry.reason ?? null, at: entry.at })],
    );
  }
  async list(): Promise<AuditEntry[]> {
    const res = await this.sql.query(
      `SELECT actor, action, target, details, event_time FROM audit_log ORDER BY event_time DESC`,
    );
    return res.rows.map((r: any) => ({
      actor: r.actor,
      action: r.action,
      target: r.target,
      reason: r.details?.reason ?? undefined,
      at: r.details?.at ?? r.event_time,
    }));
  }
}

export function classificationSummary(consumers: ImpactedConsumer[]): Record<string, number> {
  const summary: Record<string, number> = { BREAKING: 0, NON_BREAKING: 0, UNKNOWN: 0 };
  for (const c of consumers) {
    summary[c.class] = (summary[c.class] ?? 0) + 1;
  }
  return summary;
}

function mapSubscription(r: any): Subscription {
  return {
    id: r.id,
    githubFullName: r.github_full_name,
    role: r.role,
    subscribed: Boolean(r.subscribed),
    appsvn: r.appsvn ?? undefined,
    applicationLabel: r.application_label ?? undefined,
    moduleSourcesWatched: r.module_sources_watched ?? [],
    complianceScope: r.compliance_scope ?? [],
    contacts: r.contacts ?? {},
  };
}
