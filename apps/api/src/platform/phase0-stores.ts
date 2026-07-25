import { Injectable, Logger } from '@nestjs/common';
import {
  PostgresImpactReportStore,
  PostgresWatermarkStore,
  type AuditEntry,
  type AuditStore,
  type ImpactReport,
  type ImpactReportStore,
  type Notification,
  type Notifier,
  type PatternStore,
  type InfraPattern,
  type PatternStamp,
  type Watermark,
  type WatermarkStore,
  type SqlExecutor,
} from '@infragraph/platform';
import { DbService } from '../db/db.service';

function sqlFromDb(db: DbService): SqlExecutor {
  return {
    query: <T = any>(text: string, params?: unknown[]) => db.query(text, params as any[]),
  };
}

/**
 * Phase 1 dual watermark over subscriptions:
 *   indexed_sha  := last_scanned_sha (COLD/WARM; worker is authoritative in prod)
 *   last_event_sha := HOT informational only — never touches last_scanned_sha / indexed_at
 *   indexed_at   := when last_scanned_sha was advanced
 */
@Injectable()
export class Phase0WatermarkStore implements WatermarkStore {
  private readonly inner: PostgresWatermarkStore;

  constructor(db: DbService) {
    this.inner = new PostgresWatermarkStore(sqlFromDb(db));
  }

  get(repoId: string): Promise<Watermark | null> {
    return this.inner.get(repoId);
  }

  setIndexedSha(repoId: string, sha: string): Promise<void> {
    return this.inner.setIndexedSha(repoId, sha);
  }

  setLastEventSha(repoId: string, sha: string): Promise<void> {
    return this.inner.setLastEventSha(repoId, sha);
  }
}

/** Persist HOT reports to impact_reports (+ audit_log breadcrumb for existing ops). */
@Injectable()
export class Phase0ImpactReportStore implements ImpactReportStore {
  private readonly log = new Logger(Phase0ImpactReportStore.name);
  private readonly inner: PostgresImpactReportStore;

  constructor(private readonly db: DbService) {
    this.inner = new PostgresImpactReportStore(sqlFromDb(db));
  }

  async save(report: ImpactReport): Promise<void> {
    await this.inner.save(report);
    try {
      await this.db.query(
        `INSERT INTO audit_log (actor, action, target, details)
         VALUES ('impact-loop', $1, $2, $3::jsonb)`,
        [
          report.silent ? 'HOT impact silent' : 'HOT impact report',
          report.reportId,
          JSON.stringify({
            intent: report.intent,
            moduleRepoId: report.moduleRepoId,
            verdict: report.verdict,
            silent: report.silent,
            impactExists: report.impactExists,
            consumerCount: report.consumers?.length ?? 0,
            headSha: report.headSha ?? null,
            prNumber: report.prNumber ?? null,
          }),
        ],
      );
    } catch (e: any) {
      this.log.warn(`audit breadcrumb failed for ${report.reportId}: ${e?.message || e}`);
    }
  }

  get(reportId: string): Promise<ImpactReport | null> {
    return this.inner.get(reportId);
  }
}

@Injectable()
export class Phase0AuditStore implements AuditStore {
  constructor(private readonly db: DbService) {}

  async record(entry: AuditEntry): Promise<void> {
    await this.db.query(
      `INSERT INTO audit_log (actor, action, target, details) VALUES ($1,$2,$3,$4::jsonb)`,
      [entry.actor, entry.action, entry.target, JSON.stringify({ reason: entry.reason ?? null, at: entry.at })],
    );
  }

  async list(): Promise<AuditEntry[]> {
    const res = await this.db.query(
      `SELECT actor, action, target, details, event_time FROM audit_log ORDER BY event_time DESC LIMIT 100`,
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

/** Pattern stamps not wired yet — empty store (HOT still classifies contracts). */
@Injectable()
export class EmptyPatternStore implements PatternStore {
  async patternsForModule(_moduleId: string): Promise<InfraPattern[]> {
    return [];
  }
  async activeStamps(_patternId: string): Promise<PatternStamp[]> {
    return [];
  }
}

/**
 * Log-only Notifier kept for tests / fallback.
 * Live HOT path uses platform `GitHubNotifier` (Phase 3) constructed in ImpactLoopService.
 */
@Injectable()
export class LogNotifier implements Notifier {
  private readonly log = new Logger(LogNotifier.name);

  async send(notifications: Notification[]): Promise<void> {
    for (const n of notifications) {
      this.log.log(`notify role=${n.role} recipient=${n.recipient} reason=${n.reason} report=${n.reportId}`);
    }
  }
}
