// Public surface of the impact-loop platform module.

// Domain
export * from './domain/paths.ts';
export * from './domain/jobs.ts';
export * from './domain/events.ts';
export * from './domain/classification.ts';
export * from './domain/contract.ts';
export * from './domain/watermark.ts';
export * from './domain/subscription.ts';
export * from './domain/pattern.ts';
export * from './domain/impact.ts';
export * from './domain/parsed.ts';

// Ports
export * from './ports/index.ts';

// Integration / routing
export * from './integration/provider.ts';
export * from './integration/router.ts';
export * from './integration/pr-files.ts';
export { GitHubAdapter } from './integration/adapters/github.ts';
export {
  GitHubPrFileFetcher,
  githubApiBaseFromEnv,
  githubTokenFromEnv,
} from './integration/adapters/github-pr-files.ts';
export type { GitHubPrFileFetcherOptions, FetchLike as GitHubFetchLike } from './integration/adapters/github-pr-files.ts';
export { GitLabAdapter, AzureDevOpsAdapter, BitbucketAdapter } from './integration/adapters/stubs.ts';

// Contracts
export { fingerprintContract, withFingerprint } from './contracts/fingerprint.ts';
export { diffContracts } from './contracts/diff.ts';

// Impact engine
export { ImpactEngine } from './impact/engine.ts';
export type { EngineDeps, HotQueryInput } from './impact/engine.ts';
export { classify } from './impact/classifier.ts';
export { detectStaleness } from './impact/staleness.ts';
export * from './impact/delta.ts';
export { SourceResolver } from './impact/source-resolver.ts';

// Pattern guard
export { guardPattern, disturbingInputs } from './pattern/guard.ts';

// Decision
export * from './decision/policy.ts';
export { computeVerdict } from './decision/verdict.ts';

// Notify
export { resolveRecipients, DEFAULT_NOTIFY_CONFIG } from './notify/router.ts';
export type { NotifyConfig } from './notify/router.ts';
export { formatImpactPrComment, shouldPostPrComment } from './notify/comment.ts';
export type { CommentFormatOptions } from './notify/comment.ts';
export { verdictToConclusion, checkRunTitle } from './notify/check-map.ts';
export type { CheckConclusion } from './notify/check-map.ts';
export { GitHubNotifier, githubCheckNameFromEnv } from './notify/github-notifier.ts';
export type { GitHubNotifierOptions } from './notify/github-notifier.ts';

// Narration
export * from './narration/port.ts';
export { TemplateNarrator } from './narration/template.ts';
export { HttpAiNarrator, createNarratorFromEnv } from './narration/http-ai.ts';
export type { HttpAiNarratorOptions } from './narration/http-ai.ts';

// Config
export * from './config/schema.ts';
export { loadConfig, resolveConfig, DEFAULT_CONFIG } from './config/loader.ts';

// App
export { ImpactLoop } from './app/impact-loop.ts';
export type { ImpactLoopDeps, WebhookOutcome } from './app/impact-loop.ts';
export { ScanRunner } from './app/scan.ts';
export type { ScanResult } from './app/scan.ts';
export { applyOverride } from './app/override.ts';
export type { OverrideInput, OverrideDeps } from './app/override.ts';
export * from './app/deep-link.ts';

// Adapters
export * from './adapters/memory/index.ts';
export * from './adapters/postgres/index.ts';
export * from './adapters/neo4j/index.ts';
