import { Injectable, Logger } from '@nestjs/common';
import type {
  AuditEntry,
  AuditStore,
  ImpactReport,
  ImpactReportStore,
  Notification,
  Notifier,
  PatternStore,
  InfraPattern,
  PatternStamp,
  Watermark,
  WatermarkStore,
} from '@infragraph/platform';
import { DbService } from '../db/db.service';

/**
 * Phase 0 watermark: indexed_sha ← subscriptions.last_scanned_sha.
 * last_event_sha column is a Phase 1 schema follow-up — setLastEventSha is a no-op.
 */
@Injectable()
export class Phase0WatermarkStore implements WatermarkStore {
  constructor(private readonly db: DbService) {}

  async get(repoId: string): Promise<Watermark | null> {
    const res = await this.db.query(
      `SELECT id AS repo_id, last_scanned_sha AS indexed_sha FROM subscriptions WHERE id = $1`,
      [repoId],
    );
    if (!res.rows.length) return null;
    return {
      repoId: res.rows[0].repo_id,
      indexedSha: res.rows[0].indexed_sha ?? null,
      lastEventSha: null,
    };
  }

  async setIndexedSha(repoId: string, sha: string): Promise<void> {
    // COLD/WARM only — worker owns this in production; keep seam for ScanRunner.
    await this.db.query(
      `UPDATE subscriptions SET last_scanned_sha = $2, updated_at = now() WHERE id = $1`,
      [repoId, sha],
    );
  }

  async setLastEventSha(_repoId: string, _sha: string): Promise<void> {
    // Phase 1: add subscriptions.last_event_sha. No-op in Phase 0.
  }
}

/** Persist HOT reports to audit_log until impact_reports table exists (Phase 1). */
@Injectable()
export class Phase0ImpactReportStore implements ImpactReportStore {
  private readonly log = new Logger(Phase0ImpactReportStore.name);

  constructor(private readonly db: DbService) {}

  async save(report: ImpactReport): Promise<void> {
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
      this.log.warn(`failed to persist impact report ${report.reportId}: ${e?.message || e}`);
    }
  }

  async get(_reportId: string): Promise<ImpactReport | null> {
    return null;
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

/** Pattern stamps not wired in Phase 0 — empty store (HOT still classifies contracts). */
@Injectable()
export class EmptyPatternStore implements PatternStore {
  async patternsForModule(_moduleId: string): Promise<InfraPattern[]> {
    return [];
  }
  async activeStamps(_patternId: string): Promise<PatternStamp[]> {
    return [];
  }
}

@Injectable()
export class LogNotifier implements Notifier {
  private readonly log = new Logger(LogNotifier.name);

  async send(notifications: Notification[]): Promise<void> {
    for (const n of notifications) {
      this.log.log(`notify role=${n.role} recipient=${n.recipient} reason=${n.reason} report=${n.reportId}`);
    }
  }
}
