import test from 'node:test';
import assert from 'node:assert/strict';
import { fingerprintContract } from '../contracts/fingerprint.ts';
import { diffContracts } from '../contracts/diff.ts';
import type { ModuleContract } from '../domain/contract.ts';
import { validateRawConfig, ConfigError } from '../config/schema.ts';
import { resolveConfig, loadConfig } from '../config/loader.ts';
import { TemplateNarrator } from '../narration/template.ts';
import { buildNarrationUserPayload } from '../narration/port.ts';
import { ImpactClass } from '../domain/classification.ts';

function c(version: string, variables: ModuleContract['variables']): ModuleContract {
  return { moduleId: 'm', version, variables, outputs: [] };
}

test('fingerprint is deterministic and order-independent, no fake embeddings', () => {
  const a = c('v1', [{ name: 'x', type: 'string' }, { name: 'y', type: 'number' }]);
  const b = c('v1', [{ name: 'y', type: 'number' }, { name: 'x', type: 'string' }]);
  assert.equal(fingerprintContract(a), fingerprintContract(b));
  assert.ok(fingerprintContract(a).startsWith('sha256:'));

  const changed = c('v1', [{ name: 'x', type: 'number' }, { name: 'y', type: 'number' }]);
  assert.notEqual(fingerprintContract(a), fingerprintContract(changed));
});

test('diff detects added / removed / madeMandatory / changed / newRequired', () => {
  const from = c('v1', [
    { name: 'keep', type: 'string' },
    { name: 'removed', type: 'string' },
    { name: 'becomes_required', type: 'string', default: 'd' },
    { name: 'retype', type: 'string' },
  ]);
  const to = c('v2', [
    { name: 'keep', type: 'string' },
    { name: 'becomes_required', type: 'string' }, // default dropped -> mandatory
    { name: 'retype', type: 'number' }, // type changed
    { name: 'new_optional', type: 'string', default: 'd' },
    { name: 'new_required', type: 'string' }, // mandatory addition
  ]);
  const diff = diffContracts(from, to);
  assert.equal(diff.summary.removed, 1);
  assert.equal(diff.summary.madeMandatory, 1);
  assert.equal(diff.summary.changed, 1);
  assert.equal(diff.summary.added, 2);
  assert.equal(diff.summary.newRequired, 1);
  assert.deepEqual(diff.variables.removed.map((v) => v.name), ['removed']);
  assert.deepEqual(diff.variables.madeMandatory.map((m) => m.name), ['becomes_required']);
});

test('config: defaults are safe and contain no customer data', () => {
  const cfg = resolveConfig({});
  assert.deepEqual(cfg.iacExtensions, ['.tf', '.hcl']);
  assert.equal(cfg.deepLinkBaseUrl, '');
  assert.equal(cfg.requireWebhookSecret, false);
  assert.deepEqual(cfg.notify.architectRecipients, []);
  assert.equal(cfg.policy.block.onBreaking, true);
});

test('config: validation rejects malformed input', () => {
  assert.throws(() => validateRawConfig(null), ConfigError);
  assert.throws(() => validateRawConfig({ iacExtensions: 'nope' }), ConfigError);
  assert.throws(() => validateRawConfig({ requireWebhookSecret: 'yes' }), ConfigError);
  assert.doesNotThrow(() => validateRawConfig({ iacExtensions: ['.tf'] }));
});

test('config: env overrides are applied', () => {
  const cfg = loadConfig({
    PLATFORM_DEEP_LINK_BASE_URL: 'https://example.invalid',
    PLATFORM_FAIL_CLOSED_ON_UNKNOWN: 'true',
    PLATFORM_ARCHITECT_RECIPIENTS: '#a,#b',
  } as NodeJS.ProcessEnv);
  assert.equal(cfg.deepLinkBaseUrl, 'https://example.invalid');
  assert.equal(cfg.policy.failClosedOnUnknown, true);
  assert.deepEqual(cfg.notify.architectRecipients, ['#a', '#b']);
});

test('narrator returns UNKNOWN framing when evidence is absent and never invents a class', async () => {
  const narrator = new TemplateNarrator();
  const n = await narrator.narrate({
    class: ImpactClass.UNKNOWN,
    evidence: {
      consumerRepoId: 'example-consumer',
      moduleId: 'example-module',
      currentPin: null,
      targetVersion: 'example-v2',
      providedInputs: [],
      contractDiff: null,
      breakingReasons: [],
      locations: [],
      staleness: { stale: true, reason: 'missing_contract' },
    },
  });
  assert.equal(n.class, ImpactClass.UNKNOWN);
  assert.equal(n.grounded, true);
  assert.match(n.detail, /async refresh/i);
});

test('narration payload only exposes evidence fields (grounding contract)', () => {
  const payload = buildNarrationUserPayload({
    class: ImpactClass.NON_BREAKING,
    evidence: {
      consumerRepoId: 'c',
      moduleId: 'm',
      currentPin: 'v1',
      targetVersion: 'v2',
      providedInputs: ['a'],
      contractDiff: null,
      breakingReasons: [],
      locations: [],
    },
  });
  assert.deepEqual(Object.keys(payload).sort(), [
    'breaking_reasons',
    'class',
    'contract_diff_summary',
    'current_pin',
    'locations',
    'module_id',
    'provided_inputs',
    'staleness',
    'target_version',
  ]);
});
