import type { ImpactReport } from '../domain/impact.ts';
import type {
  AuditStore,
  ImpactFeedback,
  ImpactReportStore,
  Notification,
} from '../ports/index.ts';
import { CheckVerdict } from '../domain/classification.ts';

export interface OverrideInput {
  actor: string;
  reason: string;
}

export interface OverrideDeps {
  audit: AuditStore;
  reports: ImpactReportStore;
  /**
   * When set with `repoFullName`, re-publishes the check run (and comment) after
   * override so GitHub reflects WARN instead of BLOCK. Optional — API override
   * HTTP surface may wire this later.
   */
  feedback?: ImpactFeedback | null;
  /** From Subscription.githubFullName — never hardcode. */
  repoFullName?: string;
  notifications?: Notification[];
}

// Overriding a failing check MUST be audited (actor, reason, timestamp, target).
// The override downgrades a BLOCK to WARN (allow-with-warning) and stamps the
// report with who/why/when. Non-blocking verdicts cannot be overridden.
export async function applyOverride(
  report: ImpactReport,
  input: OverrideInput,
  deps: OverrideDeps,
): Promise<ImpactReport> {
  if (report.verdict !== CheckVerdict.BLOCK) {
    throw new Error('only a BLOCK verdict can be overridden');
  }
  if (!input.actor || !input.reason) {
    throw new Error('override requires actor and reason');
  }
  const at = new Date().toISOString();
  const overridden: ImpactReport = {
    ...report,
    verdict: CheckVerdict.WARN,
    override: { actor: input.actor, reason: input.reason, at, previousVerdict: report.verdict },
  };
  await deps.reports.save(overridden);
  await deps.audit.record({
    actor: input.actor,
    action: 'impact check override',
    target: report.reportId,
    reason: input.reason,
    at,
  });

  if (deps.feedback && deps.repoFullName) {
    await deps.feedback.publish({
      report: overridden,
      repoFullName: deps.repoFullName,
      notifications: deps.notifications ?? [],
    });
  }

  return overridden;
}
