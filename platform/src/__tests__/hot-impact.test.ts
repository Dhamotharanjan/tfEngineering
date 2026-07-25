import test from 'node:test';
import assert from 'node:assert/strict';
import { makeHarness, moduleSub, consumerSub, contract, pinBumpFile, FAKE } from './harness.ts';
import { JobIntent } from '../domain/jobs.ts';
import { ImpactClass, CheckVerdict } from '../domain/classification.ts';

function seedBase(h: ReturnType<typeof makeHarness>) {
  h.subscriptions.add(moduleSub());
  h.subscriptions.add(consumerSub());
  // Module graph is current (indexed == last event) so analysis is not stale.
  h.watermarks.setIndexedSha(FAKE.moduleId, FAKE.shaIndexed);
}

// Scenario 3: PR with no IaC change -> silence (no report noise, no notifications).
test('scenario 3: PR changing no IaC files is silent', async () => {
  const h = makeHarness();
  seedBase(h);
  const report = await h.engine.runHotQuery({
    intent: JobIntent.PR_IMPACT_QUERY,
    repoId: FAKE.consumerId,
    headSha: FAKE.shaHead,
    prAuthor: 'octo-dev',
    files: [{ path: 'README.md', previousContent: 'a', newContent: 'b', status: 'modified' }],
  });
  assert.equal(report.impactExists, false);
  assert.equal(report.silent, true);
  assert.equal(report.consumers.length, 0);
  assert.equal(h.notifier.sent.length, 0);
});

// Scenario 4: non-breaking pin bump (only an optional input added).
test('scenario 4: non-breaking pin bump classifies NON_BREAKING', async () => {
  const h = makeHarness();
  seedBase(h);
  await h.contracts.put(contract(FAKE.vFrom, [{ name: 'required_a' }]));
  await h.contracts.put(contract(FAKE.vTo, [{ name: 'required_a' }, { name: 'optional_b', optional: true }]));
  h.graph.setConsumers(FAKE.moduleId, [
    { consumerRepoId: FAKE.consumerId, currentPin: FAKE.vFrom, providedInputs: ['required_a'], locations: [{ file: 'main.tf', line: 2 }] },
  ]);

  const report = await h.engine.runHotQuery({
    intent: JobIntent.PR_IMPACT_QUERY,
    repoId: FAKE.consumerId,
    headSha: FAKE.shaHead,
    prAuthor: 'octo-dev',
    files: [pinBumpFile(FAKE.vFrom, FAKE.vTo)],
  });

  assert.equal(report.consumers.length, 1);
  assert.equal(report.consumers[0].class, ImpactClass.NON_BREAKING);
  assert.equal(report.verdict, CheckVerdict.PASS);
  assert.equal(report.silent, false);
  // PR author notified because impact exists.
  assert.ok(h.notifier.sent.some((n) => n.role === 'pr_author'));
});

// Scenario 5: breaking — removed input the consumer sets AND newly-required input not set.
test('scenario 5: breaking pin bump classifies BREAKING with evidence', async () => {
  const h = makeHarness();
  seedBase(h);
  await h.contracts.put(contract(FAKE.vFrom, [{ name: 'old_param' }, { name: 'required_a' }]));
  await h.contracts.put(contract(FAKE.vTo, [{ name: 'required_a' }, { name: 'new_required' }]));
  h.graph.setConsumers(FAKE.moduleId, [
    {
      consumerRepoId: FAKE.consumerId,
      currentPin: FAKE.vFrom,
      providedInputs: ['old_param', 'required_a'], // sets old_param (removed), does NOT set new_required
      locations: [{ file: 'main.tf', line: 2 }],
    },
  ]);

  const report = await h.engine.runHotQuery({
    intent: JobIntent.PR_IMPACT_QUERY,
    repoId: FAKE.consumerId,
    headSha: FAKE.shaHead,
    prAuthor: 'octo-dev',
    files: [pinBumpFile(FAKE.vFrom, FAKE.vTo)],
  });

  const consumer = report.consumers[0];
  assert.equal(consumer.class, ImpactClass.BREAKING);
  const kinds = consumer.evidence.breakingReasons.map((r) => r.kind).sort();
  assert.deepEqual(kinds, ['new_required_missing', 'removed_input_in_use']);
  assert.equal(report.verdict, CheckVerdict.BLOCK);
  // Consumer owners notified on BREAKING.
  assert.ok(h.notifier.sent.some((n) => n.role === 'consumer_owner'));
  // Narration echoes the class, never changes it.
  assert.equal(consumer.narration?.class, ImpactClass.BREAKING);
  assert.equal(consumer.narration?.source, 'template');
});

// Scenario 7: tag fan-out — release tag on upstream reaches all consumers.
test('scenario 7: tag release fans out to consumers', async () => {
  const h = makeHarness();
  seedBase(h);
  const consumerB = 'example-consumer-app-b';
  h.subscriptions.add(consumerSub({ id: consumerB, githubFullName: 'example-org/example-consumer-app-b' }));
  await h.contracts.put(contract(FAKE.vFrom, [{ name: 'required_a' }]));
  await h.contracts.put(contract(FAKE.vTo, [{ name: 'required_a' }, { name: 'new_required' }]));
  h.graph.setConsumers(FAKE.moduleId, [
    { consumerRepoId: FAKE.consumerId, currentPin: FAKE.vFrom, providedInputs: ['required_a'], locations: [{ file: 'a/main.tf' }] },
    { consumerRepoId: consumerB, currentPin: FAKE.vFrom, providedInputs: ['required_a'], locations: [{ file: 'b/main.tf' }] },
  ]);

  const report = await h.engine.runHotQuery({
    intent: JobIntent.TAG_IMPACT_QUERY,
    repoId: FAKE.moduleId,
    tag: FAKE.vTo,
    headSha: FAKE.shaHead,
  });

  assert.equal(report.consumers.length, 2);
  // Both miss the newly-required input -> BREAKING.
  assert.ok(report.consumers.every((c) => c.class === ImpactClass.BREAKING));
  const ids = report.consumers.map((c) => c.consumerRepoId).sort();
  assert.deepEqual(ids, [consumerB, FAKE.consumerId].sort());
});

// Scenario 8: stale graph -> UNKNOWN + async WARM enqueued + NO graph write.
test('scenario 8: stale graph yields UNKNOWN, enqueues WARM, writes no graph', async () => {
  const h = makeHarness();
  h.subscriptions.add(moduleSub());
  h.subscriptions.add(consumerSub());
  // Graph is behind: last event sha != indexed sha => stale.
  await h.watermarks.setIndexedSha(FAKE.moduleId, 'sha-old');
  await h.watermarks.setLastEventSha(FAKE.moduleId, 'sha-new');
  await h.contracts.put(contract(FAKE.vFrom, [{ name: 'required_a' }]));
  await h.contracts.put(contract(FAKE.vTo, [{ name: 'required_a' }]));
  h.graph.setConsumers(FAKE.moduleId, [
    { consumerRepoId: FAKE.consumerId, currentPin: FAKE.vFrom, providedInputs: ['required_a'], locations: [{ file: 'main.tf' }] },
  ]);

  const indexedBefore = h.watermarks.indexedShaWrites.length;

  const report = await h.engine.runHotQuery({
    intent: JobIntent.PR_IMPACT_QUERY,
    repoId: FAKE.consumerId,
    headSha: FAKE.shaHead,
    files: [pinBumpFile(FAKE.vFrom, FAKE.vTo)],
    prAuthor: 'octo-dev',
  });

  assert.equal(report.consumers[0].class, ImpactClass.UNKNOWN);
  assert.equal(report.consumers[0].evidence.staleness?.stale, true);
  // Async WARM refresh enqueued for the module. Never rebuilt inline.
  assert.ok(h.jobs.jobs.some((j) => j.intent === JobIntent.WARM_INCREMENTAL && j.repoId === FAKE.moduleId));
  assert.ok(report.refreshEnqueued.length >= 1);
  // No graph write, no indexed_sha advance.
  assert.equal(h.graphWriter.writes.length, 0);
  assert.equal(h.watermarks.indexedShaWrites.length, indexedBefore);
});

// Missing contracts also -> UNKNOWN (never guessed).
test('missing contract yields UNKNOWN, not a guess', async () => {
  const h = makeHarness();
  seedBase(h);
  // Only the "to" contract exists.
  await h.contracts.put(contract(FAKE.vTo, [{ name: 'required_a' }]));
  h.graph.setConsumers(FAKE.moduleId, [
    { consumerRepoId: FAKE.consumerId, currentPin: FAKE.vFrom, providedInputs: ['required_a'], locations: [{ file: 'main.tf' }] },
  ]);
  const report = await h.engine.runHotQuery({
    intent: JobIntent.PR_IMPACT_QUERY,
    repoId: FAKE.consumerId,
    headSha: FAKE.shaHead,
    files: [pinBumpFile(FAKE.vFrom, FAKE.vTo)],
    prAuthor: 'octo-dev',
  });
  assert.equal(report.consumers[0].class, ImpactClass.UNKNOWN);
});
