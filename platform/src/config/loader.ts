import { readFileSync } from 'node:fs';
import type { PlatformConfig, RawPlatformConfig } from './schema.ts';
import { validateRawConfig } from './schema.ts';
import { DEFAULT_POLICY, mergePolicy } from '../decision/policy.ts';
import { DEFAULT_NOTIFY_CONFIG } from '../notify/router.ts';

// Documented environment variables (all optional; safe defaults):
//   PLATFORM_DEEP_LINK_BASE_URL   base URL for deep links (default "")
//   PLATFORM_IAC_EXTENSIONS       comma list of extensions (default ".tf,.hcl")
//   PLATFORM_REQUIRE_WEBHOOK_SECRET  "true"/"false" (default false)
//   PLATFORM_FAIL_CLOSED_ON_UNKNOWN  "true"/"false" (default false)
//   PLATFORM_BLOCK_ON_BREAKING       "true"/"false" (default true)
//   PLATFORM_BLOCK_ON_DISTURBED      "true"/"false" (default true)
//   PLATFORM_ARCHITECT_RECIPIENTS    comma list (default empty)
//   PLATFORM_OWNER_CONTACT_KEYS      comma list (default owners,oncall,primary_team)
//   PLATFORM_CONFIG_FILE             optional path to a JSON config file

export const DEFAULT_CONFIG: PlatformConfig = {
  deepLinkBaseUrl: '',
  iacExtensions: ['.tf', '.hcl'],
  requireWebhookSecret: false,
  policy: DEFAULT_POLICY,
  notify: DEFAULT_NOTIFY_CONFIG,
};

function csv(v: string | undefined): string[] | undefined {
  if (v === undefined) return undefined;
  const list = v.split(',').map((s) => s.trim()).filter(Boolean);
  return list;
}

function bool(v: string | undefined): boolean | undefined {
  if (v === undefined) return undefined;
  return v.toLowerCase() === 'true';
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): PlatformConfig {
  let fromFile: RawPlatformConfig = {};
  const file = env.PLATFORM_CONFIG_FILE;
  if (file) {
    fromFile = validateRawConfig(JSON.parse(readFileSync(file, 'utf8')));
  }

  const raw: RawPlatformConfig = {
    deepLinkBaseUrl: env.PLATFORM_DEEP_LINK_BASE_URL ?? fromFile.deepLinkBaseUrl,
    iacExtensions: csv(env.PLATFORM_IAC_EXTENSIONS) ?? fromFile.iacExtensions,
    requireWebhookSecret: bool(env.PLATFORM_REQUIRE_WEBHOOK_SECRET) ?? fromFile.requireWebhookSecret,
    policy: {
      block: {
        onBreaking: bool(env.PLATFORM_BLOCK_ON_BREAKING) ?? fromFile.policy?.block?.onBreaking,
        onDisturbedPattern: bool(env.PLATFORM_BLOCK_ON_DISTURBED) ?? fromFile.policy?.block?.onDisturbedPattern,
      },
      failClosedOnUnknown: bool(env.PLATFORM_FAIL_CLOSED_ON_UNKNOWN) ?? fromFile.policy?.failClosedOnUnknown,
      notify: fromFile.policy?.notify,
    },
    notify: {
      architectRecipients: csv(env.PLATFORM_ARCHITECT_RECIPIENTS) ?? fromFile.notify?.architectRecipients,
      ownerContactKeys: csv(env.PLATFORM_OWNER_CONTACT_KEYS) ?? fromFile.notify?.ownerContactKeys,
    },
  };

  return resolveConfig(raw);
}

export function resolveConfig(raw: RawPlatformConfig): PlatformConfig {
  return {
    deepLinkBaseUrl: raw.deepLinkBaseUrl ?? DEFAULT_CONFIG.deepLinkBaseUrl,
    iacExtensions: raw.iacExtensions && raw.iacExtensions.length ? raw.iacExtensions : DEFAULT_CONFIG.iacExtensions,
    requireWebhookSecret: raw.requireWebhookSecret ?? DEFAULT_CONFIG.requireWebhookSecret,
    policy: mergePolicy(DEFAULT_POLICY, raw.policy),
    notify: {
      architectRecipients: raw.notify?.architectRecipients ?? DEFAULT_NOTIFY_CONFIG.architectRecipients,
      ownerContactKeys:
        raw.notify?.ownerContactKeys && raw.notify.ownerContactKeys.length
          ? raw.notify.ownerContactKeys
          : DEFAULT_NOTIFY_CONFIG.ownerContactKeys,
    },
  };
}
