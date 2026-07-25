import { CheckVerdict } from '../domain/classification.ts';
import type { ImpactReport } from '../domain/impact.ts';

/** GitHub Check Run conclusion values we emit. */
export type CheckConclusion = 'success' | 'neutral' | 'failure';

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
