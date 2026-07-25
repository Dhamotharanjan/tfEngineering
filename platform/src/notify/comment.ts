import type { ImpactReport } from '../domain/impact.ts';
import type { Notification } from '../ports/index.ts';
import { ImpactClass, PatternVerdict } from '../domain/classification.ts';
import { buildDeepLinks } from '../app/deep-link.ts';

export interface CommentFormatOptions {
  deepLinkBaseUrl: string;
  /** Optional check/product name for the heading (from config/env, not a customer id). */
  productLabel?: string;
}

function countByClass(report: ImpactReport): Record<ImpactClass, number> {
  const counts: Record<ImpactClass, number> = {
    [ImpactClass.BREAKING]: 0,
    [ImpactClass.NON_BREAKING]: 0,
    [ImpactClass.UNKNOWN]: 0,
  };
  for (const c of report.consumers) {
    counts[c.class] = (counts[c.class] ?? 0) + 1;
  }
  return counts;
}

function locationLabel(file?: string, line?: number): string {
  if (!file) return '';
  return line != null ? `\`${file}:${line}\`` : `\`${file}\``;
}

/**
 * Compact PR comment body. Caller must skip posting when `report.silent`.
 * Mentions come only from resolved notifications (subscription contacts / config roles).
 */
export function formatImpactPrComment(
  report: ImpactReport,
  notifications: Notification[],
  opts: CommentFormatOptions,
): string {
  const label = (opts.productLabel || 'InfraGraph Impact').trim() || 'InfraGraph Impact';
  const counts = countByClass(report);
  const links = buildDeepLinks(opts.deepLinkBaseUrl, report);
  const lines: string[] = [];

  lines.push(`## ${label} — **${report.verdict}**`);
  lines.push('');
  lines.push('| Class | Count |');
  lines.push('| --- | ---: |');
  lines.push(`| Breaking | ${counts[ImpactClass.BREAKING]} |`);
  lines.push(`| Non-breaking | ${counts[ImpactClass.NON_BREAKING]} |`);
  lines.push(`| Unknown | ${counts[ImpactClass.UNKNOWN]} |`);
  lines.push('');

  const keyConsumers = report.consumers.slice(0, 8);
  if (keyConsumers.length) {
    lines.push('**Key consumers**');
    for (const c of keyConsumers) {
      const loc = c.evidence.locations[0];
      const locStr = locationLabel(loc?.file, loc?.line);
      const bit = locStr ? ` — ${locStr}` : '';
      lines.push(`- \`${c.consumerRepoId}\`${bit} — ${c.class}`);
    }
    if (report.consumers.length > keyConsumers.length) {
      lines.push(`- …and ${report.consumers.length - keyConsumers.length} more`);
    }
    lines.push('');
  }

  const disturbed = report.patternChecks.filter((p) => p.verdict === PatternVerdict.DISTURBED);
  if (disturbed.length) {
    lines.push(
      `**Pattern:** DISTURBED (${disturbed.map((d) => d.patternId).join(', ')})`,
    );
    lines.push('');
  }

  const architects = notifications.filter((n) => n.role === 'architect').map((n) => n.recipient);
  const uniqueArch = [...new Set(architects)];
  if (uniqueArch.length) {
    lines.push(`cc ${uniqueArch.join(' ')}`);
    lines.push('');
  }

  lines.push(`[Open Release analysis](${links.report})`);
  return lines.join('\n');
}

/** True when a PR comment should be posted (silence rule). */
export function shouldPostPrComment(report: ImpactReport): boolean {
  return !report.silent && report.impactExists;
}
