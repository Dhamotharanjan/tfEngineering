import type { Policy, DeepPartial } from '../decision/policy.ts';
import type { NotifyConfig } from '../notify/router.ts';

// Full platform config. Every value has a safe, non-customer default. Nothing
// here identifies a real repo, org, module, or version.
export interface PlatformConfig {
  // Base URL for deep links (UI). Empty default -> relative links.
  deepLinkBaseUrl: string;
  // File extensions considered IaC-relevant. Default matches the worker.
  iacExtensions: string[];
  // Require webhook signature verification. Adapters skip verify when a secret
  // is absent AND this is false (local/dev only).
  requireWebhookSecret: boolean;
  policy: Policy;
  notify: NotifyConfig;
}

// Raw (untrusted) config as read from JSON/env before validation.
export interface RawPlatformConfig {
  deepLinkBaseUrl?: string;
  iacExtensions?: string[];
  requireWebhookSecret?: boolean;
  policy?: DeepPartial<Policy>;
  notify?: Partial<NotifyConfig>;
}

export class ConfigError extends Error {}

// Validate a raw config object. Throws ConfigError with a clear message.
export function validateRawConfig(raw: unknown): RawPlatformConfig {
  if (raw === null || typeof raw !== 'object') {
    throw new ConfigError('config must be an object');
  }
  const r = raw as Record<string, unknown>;
  if (r.iacExtensions !== undefined) {
    if (!Array.isArray(r.iacExtensions) || r.iacExtensions.some((e) => typeof e !== 'string')) {
      throw new ConfigError('iacExtensions must be an array of strings');
    }
  }
  if (r.deepLinkBaseUrl !== undefined && typeof r.deepLinkBaseUrl !== 'string') {
    throw new ConfigError('deepLinkBaseUrl must be a string');
  }
  if (r.requireWebhookSecret !== undefined && typeof r.requireWebhookSecret !== 'boolean') {
    throw new ConfigError('requireWebhookSecret must be a boolean');
  }
  if (r.notify !== undefined) {
    const n = r.notify as Record<string, unknown>;
    if (n.architectRecipients !== undefined && !Array.isArray(n.architectRecipients)) {
      throw new ConfigError('notify.architectRecipients must be an array');
    }
    if (n.ownerContactKeys !== undefined && !Array.isArray(n.ownerContactKeys)) {
      throw new ConfigError('notify.ownerContactKeys must be an array');
    }
  }
  return r as RawPlatformConfig;
}
