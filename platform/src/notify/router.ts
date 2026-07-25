import type { ImpactReport } from '../domain/impact.ts';
import type { Subscription } from '../domain/subscription.ts';
import type { Notification } from '../ports/index.ts';
import { ImpactClass, PatternVerdict } from '../domain/classification.ts';
import type { Policy } from '../decision/policy.ts';
import { consumerDeepLink } from '../app/deep-link.ts';

// Resolves WHO gets notified from subscription metadata + config roles.
// No hardcoded handles anywhere. Recipients are taken from:
//   - the PR author on the event (pr_author)
//   - the consumer subscription's contacts (owners / oncall / primary_team)
//   - the architect role from config (architectRecipients) for DISTURBED patterns
export interface NotifyConfig {
  architectRecipients: string[]; // from config/UI, e.g. ["#arch-review"]
  // Which contact keys on a subscription identify the owning humans/teams.
  ownerContactKeys: string[]; // e.g. ["owners", "oncall", "primary_team"]
}

export const DEFAULT_NOTIFY_CONFIG: NotifyConfig = {
  architectRecipients: [],
  ownerContactKeys: ['owners', 'oncall', 'primary_team'],
};

function ownersOf(sub: Subscription | null, keys: string[]): string[] {
  if (!sub || !sub.contacts) return [];
  const out: string[] = [];
  for (const k of keys) {
    const v = sub.contacts[k];
    if (v && !out.includes(v)) out.push(v);
  }
  return out;
}

export function resolveRecipients(
  report: ImpactReport,
  opts: {
    policy: Policy;
    notifyConfig: NotifyConfig;
    baseUrl: string;
    subscriptionsById: Map<string, Subscription>;
  },
): Notification[] {
  const notifications: Notification[] = [];
  if (report.silent || !report.impactExists) return notifications;

  const { policy, notifyConfig, baseUrl } = opts;

  // 1) PR author always, when impact exists.
  if (policy.notify.prAuthorOnImpact && report.prAuthor) {
    notifications.push({
      recipient: report.prAuthor,
      role: 'pr_author',
      reason: 'Impact detected on your change',
      reportId: report.reportId,
      deepLink: report.consumers.length
        ? consumerDeepLink(baseUrl, report.moduleRepoId, report.consumers[0].consumerRepoId)
        : `${baseUrl.replace(/\/+$/, '')}/impact/reports/${encodeURIComponent(report.reportId)}`,
    });
  }

  // 2) Consumer owners for BREAKING / UNKNOWN.
  if (policy.notify.consumerOwnersOnBreakingOrUnknown) {
    for (const c of report.consumers) {
      if (c.class !== ImpactClass.BREAKING && c.class !== ImpactClass.UNKNOWN) continue;
      const sub = opts.subscriptionsById.get(c.consumerRepoId) ?? null;
      for (const owner of ownersOf(sub, notifyConfig.ownerContactKeys)) {
        notifications.push({
          recipient: owner,
          role: 'consumer_owner',
          reason: `${c.class} impact on ${c.consumerRepoId}`,
          reportId: report.reportId,
          deepLink: consumerDeepLink(baseUrl, report.moduleRepoId, c.consumerRepoId),
        });
      }
    }
  }

  // 3) Architect when a stamped pattern is DISTURBED.
  if (policy.notify.architectOnDisturbedPattern) {
    const disturbed = report.patternChecks.filter((p) => p.verdict === PatternVerdict.DISTURBED);
    if (disturbed.length) {
      for (const recipient of notifyConfig.architectRecipients) {
        notifications.push({
          recipient,
          role: 'architect',
          reason: `Pattern disturbed: ${disturbed.map((d) => d.patternId).join(', ')}`,
          reportId: report.reportId,
          deepLink: `${baseUrl.replace(/\/+$/, '')}/impact/reports/${encodeURIComponent(report.reportId)}`,
        });
      }
    }
  }

  return dedupe(notifications);
}

function dedupe(list: Notification[]): Notification[] {
  const seen = new Set<string>();
  const out: Notification[] = [];
  for (const n of list) {
    const key = `${n.recipient}|${n.role}|${n.reason}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(n);
  }
  return out;
}
