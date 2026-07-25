// Shared test harness. Wires the ImpactEngine + ScanRunner against in-memory
// adapters. All identities here are OBVIOUSLY FAKE placeholders and never leak
// into runtime code (this file lives under __tests__ and is imported by tests
// only).
import {
  MemoryGraphReader,
  MemoryGraphWriter,
  MemorySubscriptionReader,
  MemoryWatermarkStore,
  MemoryContractStore,
  MemoryPatternStore,
  MemoryImpactReportStore,
  MemoryJobEnqueuer,
  MemoryAuditStore,
  MemoryNotifier,
} from '../adapters/memory/index.ts';
import { ImpactEngine } from '../impact/engine.ts';
import { ScanRunner } from '../app/scan.ts';
import { TemplateNarrator } from '../narration/template.ts';
import { resolveConfig } from '../config/loader.ts';
import type { RawPlatformConfig } from '../config/schema.ts';
import type { Subscription } from '../domain/subscription.ts';
import type { ModuleContract } from '../domain/contract.ts';

// Fake, non-customer identities used only in tests.
export const FAKE = {
  moduleId: 'example-upstream-module',
  moduleGithub: 'example-org/example-upstream-module',
  moduleSource: 'git::https://git.example.invalid/example-org/example-upstream-module.git//stack',
  consumerId: 'example-consumer-app',
  consumerGithub: 'example-org/example-consumer-app',
  vFrom: 'example-v1',
  vTo: 'example-v2',
  shaIndexed: 'sha-indexed-0001',
  shaHead: 'sha-head-0002',
};

export function makeHarness(rawConfig?: RawPlatformConfig) {
  const graph = new MemoryGraphReader();
  const graphWriter = new MemoryGraphWriter();
  const subscriptions = new MemorySubscriptionReader();
  const watermarks = new MemoryWatermarkStore();
  const contracts = new MemoryContractStore();
  const patterns = new MemoryPatternStore();
  const reports = new MemoryImpactReportStore();
  const jobs = new MemoryJobEnqueuer();
  const audit = new MemoryAuditStore();
  const notifier = new MemoryNotifier();
  const narrator = new TemplateNarrator();
  const config = resolveConfig(rawConfig ?? {});

  const engine = new ImpactEngine({
    graph,
    subscriptions,
    contracts,
    watermarks,
    patterns,
    reports,
    jobs,
    notifier,
    narrator,
    config,
  });

  const scanRunner = new ScanRunner({ graph: graphWriter, watermarks, audit });

  return {
    graph,
    graphWriter,
    subscriptions,
    watermarks,
    contracts,
    patterns,
    reports,
    jobs,
    audit,
    notifier,
    narrator,
    config,
    engine,
    scanRunner,
  };
}

export function moduleSub(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: FAKE.moduleId,
    githubFullName: FAKE.moduleGithub,
    role: 'module_source',
    subscribed: true,
    contacts: { primary_team: 'example-platform-team', oncall: 'example:oncall' },
    ...overrides,
  };
}

export function consumerSub(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: FAKE.consumerId,
    githubFullName: FAKE.consumerGithub,
    role: 'downstream_consumer',
    subscribed: true,
    moduleSourcesWatched: [FAKE.moduleGithub],
    contacts: { owners: 'example:consumer-owners', primary_team: 'example-app-team' },
    ...overrides,
  };
}

// Contract builders. `mandatory` inputs have no default; `optional` have one.
export function contract(
  version: string,
  vars: Array<{ name: string; type?: string; optional?: boolean }>,
): ModuleContract {
  return {
    moduleId: FAKE.moduleId,
    version,
    moduleSource: FAKE.moduleSource,
    variables: vars.map((v) => ({
      name: v.name,
      type: v.type ?? 'string',
      ...(v.optional ? { default: 'example-default' } : {}),
    })),
    outputs: [{ name: 'example_output' }],
  };
}

// Build a changed .tf file that bumps the module pin from one ref to another.
export function pinBumpFile(fromRef: string, toRef: string, path = 'stacks/example/main.tf') {
  const line = (ref: string) => `  source = "${FAKE.moduleSource}?ref=${ref}"\n`;
  return {
    path,
    previousContent: `module "example" {\n${line(fromRef)}}\n`,
    newContent: `module "example" {\n${line(toRef)}}\n`,
    status: 'modified' as const,
  };
}
