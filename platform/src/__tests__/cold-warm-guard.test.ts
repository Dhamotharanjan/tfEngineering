import test from 'node:test';
import assert from 'node:assert/strict';
import { makeHarness, moduleSub, consumerSub, contract, pinBumpFile, FAKE } from './harness.ts';
import { JobIntent } from '../domain/jobs.ts';
import type { ParsedRepo } from '../domain/parsed.ts';

function parsed(repoId: string, sha: string): ParsedRepo {
  return { repoId, headSha: sha, modules: [{ source: FAKE.moduleSource, ref: FAKE.vTo }] };
}

// Scenario 1: cold subscribe -> full scan writes graph + sets indexed_sha.
test('scenario 1: COLD subscribe writes graph and sets indexed_sha', async () => {
  const h = makeHarness();
  const result = await h.scanRunner.runCold(FAKE.moduleId, parsed(FAKE.moduleId, 'sha-cold'));
  assert.equal(result.path, 'COLD');
  assert.equal(h.graphWriter.writes.length, 1);
  assert.equal(h.graphWriter.writes[0].mode, 'full');
  assert.deepEqual(h.watermarks.indexedShaWrites, [{ repoId: FAKE.moduleId, sha: 'sha-cold' }]);
  const wm = await h.watermarks.get(FAKE.moduleId);
  assert.equal(wm?.indexedSha, 'sha-cold');
});

// Scenario 2: warm push -> incremental scan writes graph + advances indexed_sha.
test('scenario 2: WARM push writes graph incrementally and advances indexed_sha', async () => {
  const h = makeHarness();
  await h.scanRunner.runCold(FAKE.moduleId, parsed(FAKE.moduleId, 'sha-1'));
  const result = await h.scanRunner.runWarm(FAKE.moduleId, parsed(FAKE.moduleId, 'sha-2'));
  assert.equal(result.path, 'WARM');
  assert.equal(h.graphWriter.writes.at(-1)?.mode, 'incremental');
  const wm = await h.watermarks.get(FAKE.moduleId);
  assert.equal(wm?.indexedSha, 'sha-2');
  assert.equal(h.watermarks.indexedShaWrites.length, 2);
});

// GUARD: HOT paths perform ZERO graph writes and NEVER advance indexed_sha.
test('guard: HOT paths never write the graph and never advance indexed_sha', async () => {
  const h = makeHarness();
  h.subscriptions.add(moduleSub());
  h.subscriptions.add(consumerSub());
  await h.contracts.put(contract(FAKE.vFrom, [{ name: 'a' }]));
  await h.contracts.put(contract(FAKE.vTo, [{ name: 'a' }]));
  await h.watermarks.setIndexedSha(FAKE.moduleId, FAKE.shaIndexed); // pre-existing graph truth
  h.graph.setConsumers(FAKE.moduleId, [
    { consumerRepoId: FAKE.consumerId, currentPin: FAKE.vFrom, providedInputs: ['a'], locations: [{ file: 'main.tf' }] },
  ]);

  const indexedWritesBefore = h.watermarks.indexedShaWrites.length;

  // HOT: pull_request
  await h.engine.runHotQuery({
    intent: JobIntent.PR_IMPACT_QUERY,
    repoId: FAKE.consumerId,
    headSha: FAKE.shaHead,
    files: [pinBumpFile(FAKE.vFrom, FAKE.vTo)],
    prAuthor: 'octo-dev',
  });

  // HOT: tag_impact_query
  await h.engine.runHotQuery({
    intent: JobIntent.TAG_IMPACT_QUERY,
    repoId: FAKE.moduleId,
    tag: FAKE.vTo,
    headSha: FAKE.shaHead,
  });

  // No graph writes at all on HOT.
  assert.equal(h.graphWriter.writes.length, 0);
  // indexed_sha never advanced by HOT (only the pre-test COLD-style seed remains).
  assert.equal(h.watermarks.indexedShaWrites.length, indexedWritesBefore);
  // HOT may record informational last_event_sha.
  assert.ok(h.watermarks.lastEventShaWrites.length >= 1);
});
