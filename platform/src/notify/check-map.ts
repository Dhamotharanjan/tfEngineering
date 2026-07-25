import { CheckVerdict } from '../domain/classification.ts';
import type { ImpactReport } from '../domain/impact.ts';

/** GitHub Check Run conclusion values we emit. */
export type CheckConclusion = 'success' | 'neutral' | 'failure';

/** GitHub Commit Statuses API `state` values we emit. */
export type CommitStatusState = 'success' | 'pending' | 'failure' | 'error';

/**
 * PASS → success, WARN → neutral, BLOCK → failure.
 * Silent / no-IaC reports stay green (success) so empty PRs are not noisy.
 */
export function verdictToConclusion(report: ImpactReport): CheckConclusion {
  if (report.silent || !report.impactExists) return 'success';
  switch (report.verdict) {
    case CheckVerdict.BLOCK:
      return 'failure';
    case CheckVerdict.WARN:
      return 'neutral';
    case CheckVerdict.PASS:
    default:
      return 'success';
  }
}

/**
 * Commit Statuses API has no `neutral`. Map:
 * PASS / silent → success, WARN → success (description carries WARN), BLOCK → failure.
 */
export function verdictToCommitStatus(report: ImpactReport): CommitStatusState {
  if (report.silent || !report.impactExists) return 'success';
  switch (report.verdict) {
    case CheckVerdict.BLOCK:
      return 'failure';
    case CheckVerdict.WARN:
    case CheckVerdict.PASS:
    default:
      return 'success';
  }
}

export function checkRunTitle(report: ImpactReport): string {
  if (report.silent || !report.impactExists) return 'No IaC impact';
  switch (report.verdict) {
    case CheckVerdict.BLOCK:
      return 'Impact BLOCK';
    case CheckVerdict.WARN:
      return 'Impact WARN';
    default:
      return 'Impact PASS';
  }
}

/** Short Commit Statuses `description` (GitHub truncates ~140 chars). */
export function commitStatusDescription(report: ImpactReport): string {
  if (report.silent || !report.impactExists) return 'No IaC impact';
  const title = checkRunTitle(report);
  const n = report.consumers.length;
  const base =
    report.verdict === CheckVerdict.WARN
      ? `WARN: ${title} · ${n} consumer(s)`
      : `${title} · ${n} consumer(s)`;
  return base.length > 140 ? `${base.slice(0, 137)}...` : base;
}
