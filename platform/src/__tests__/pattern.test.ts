import test from 'node:test';
import assert from 'node:assert/strict';
import { makeHarness, moduleSub, consumerSub, contract, pinBumpFile, FAKE } from './harness.ts';
import { JobIntent } from '../domain/jobs.ts';
import { PatternVerdict } from '../domain/classification.ts';

// Scenario 6: a stamped pattern is disturbed -> architect is notified.
test('scenario 6: disturbed stamped pattern notifies the architect', async () => {
  const h = makeHarness({ notify: { architectRecipients: ['#example-architecture-review'] } });
  h.subscriptions.add(moduleSub());
  h.subscriptions.add(consumerSub());
  await h.watermarks.setIndexedSha(FAKE.moduleId, FAKE.shaIndexed);

  // v2 removes a guarded input -> disturbs the pattern.
  await h.contracts.put(contract(FAKE.vFrom, [{ name: 'ha_multi_az' }, { name: 'required_a' }]));
  await h.contracts.put(contract(FAKE.vTo, [{ name: 'required_a' }]));
  h.graph.setConsumers(FAKE.moduleId, [
    { consumerRepoId: FAKE.consumerId, currentPin: FAKE.vFrom, providedInputs: ['ha_multi_az', 'required_a'], locations: [{ file: 'main.tf' }] },
  ]);

  const patternId = 'PAT-EXAMPLE-HA';
  h.patterns.setPatterns(FAKE.moduleId, [
    { patternId, family: 'example-family', displayName: 'Example HA', guardedInputs: ['ha_multi_az'], moduleIds: [FAKE.moduleId] },
  ]);
  h.patterns.setStamps(patternId, [{ patternId, auditor: 'example-auditor', active: true, complianceFramework: 'example-framework' }]);

  const report = await h.engine.runHotQuery({
    intent: JobIntent.PR_IMPACT_QUERY,
    repoId: FAKE.consumerId,
    headSha: FAKE.shaHead,
    prAuthor: 'octo-dev',
    files: [pinBumpFile(FAKE.vFrom, FAKE.vTo)],
  });

  const check = report.patternChecks.find((p) => p.patternId === patternId);
  assert.ok(check);
  assert.equal(check.verdict, PatternVerdict.DISTURBED);
  assert.deepEqual(check.disturbedInputs, ['ha_multi_az']);
  assert.ok(h.notifier.sent.some((n) => n.role === 'architect' && n.recipient === '#example-architecture-review'));
});

// A disturbed guarded input WITHOUT an active stamp is not a compliance event.
test('unstamped pattern is COMPATIBLE even if a guarded input changes', async () => {
  const h = makeHarness({ notify: { architectRecipients: ['#example-architecture-review'] } });
  h.subscriptions.add(moduleSub());
  h.subscriptions.add(consumerSub());
  await h.watermarks.setIndexedSha(FAKE.moduleId, FAKE.shaIndexed);
  await h.contracts.put(contract(FAKE.vFrom, [{ name: 'ha_multi_az' }, { name: 'required_a' }]));
  await h.contracts.put(contract(FAKE.vTo, [{ name: 'required_a' }]));
  h.graph.setConsumers(FAKE.moduleId, [
    { consumerRepoId: FAKE.consumerId, currentPin: FAKE.vFrom, providedInputs: ['required_a'], locations: [{ file: 'main.tf' }] },
  ]);
  const patternId = 'PAT-EXAMPLE-HA';
  h.patterns.setPatterns(FAKE.moduleId, [
    { patternId, family: 'example-family', displayName: 'Example HA', guardedInputs: ['ha_multi_az'], moduleIds: [FAKE.moduleId] },
  ]);
  h.patterns.setStamps(patternId, [{ patternId, auditor: 'example-auditor', active: false }]); // revoked

  const report = await h.engine.runHotQuery({
    intent: JobIntent.PR_IMPACT_QUERY,
    repoId: FAKE.consumerId,
    headSha: FAKE.shaHead,
    prAuthor: 'octo-dev',
    files: [pinBumpFile(FAKE.vFrom, FAKE.vTo)],
  });
  const check = report.patternChecks.find((p) => p.patternId === patternId);
  assert.equal(check?.verdict, PatternVerdict.COMPATIBLE);
  assert.equal(h.notifier.sent.some((n) => n.role === 'architect'), false);
});
