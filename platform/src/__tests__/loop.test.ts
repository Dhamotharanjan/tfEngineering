import test from 'node:test';
import assert from 'node:assert/strict';
import { makeHarness, moduleSub, consumerSub, contract, FAKE } from './harness.ts';
import { ImpactLoop } from '../app/impact-loop.ts';
import { GitHubAdapter } from '../integration/adapters/github.ts';
import { JobIntent } from '../domain/jobs.ts';

function rawWebhook(event: string, body: unknown) {
  return { headers: { 'x-github-event': event, 'x-github-delivery': 'd1' }, rawBody: JSON.stringify(body), body };
}

function makeLoop() {
  const h = makeHarness();
  h.subscriptions.add(moduleSub());
  h.subscriptions.add(consumerSub());
  const loop = new ImpactLoop({ subscriptions: h.subscriptions, jobs: h.jobs, engine: h.engine, config: h.config });
  return { h, loop, adapter: new GitHubAdapter() };
}

test('loop: push on default branch enqueues a COLD/WARM job for the worker (no inline graph write)', async () => {
  const { h, loop, adapter } = makeLoop();
  const outcome = await loop.handleWebhook(
    adapter,
    rawWebhook('push', {
      repository: { full_name: FAKE.moduleGithub, default_branch: 'main' },
      ref: 'refs/heads/main',
      after: 'sha-after',
      commits: [{ modified: ['main.tf'] }],
    }),
    undefined,
  );
  assert.equal(outcome.job?.intent, JobIntent.WARM_INCREMENTAL);
  assert.ok(outcome.enqueued);
  assert.equal(h.jobs.jobs.length, 1);
  assert.equal(h.graphWriter.writes.length, 0); // loop never writes the graph itself
});

test('loop: pull_request runs the HOT engine inline and returns a report', async () => {
  const { h, loop, adapter } = makeLoop();
  await h.watermarks.setIndexedSha(FAKE.moduleId, FAKE.shaIndexed);
  await h.contracts.put(contract(FAKE.vFrom, [{ name: 'a' }]));
  await h.contracts.put(contract(FAKE.vTo, [{ name: 'a' }]));

  const outcome = await loop.handleWebhook(
    adapter,
    rawWebhook('pull_request', {
      action: 'synchronize',
      number: 42,
      repository: { full_name: FAKE.consumerGithub },
      pull_request: { head: { sha: 'h' }, base: { sha: 'b' }, user: { login: 'octo-dev' } },
    }),
    undefined,
  );
  assert.equal(outcome.job?.intent, JobIntent.PR_IMPACT_QUERY);
  assert.ok(outcome.report);
  // No IaC files supplied by this payload -> silent, but still a HOT report.
  assert.equal(outcome.report.silent, true);
});

test('loop: unsubscribed repo is skipped', async () => {
  const { loop, adapter } = makeLoop();
  const outcome = await loop.handleWebhook(
    adapter,
    rawWebhook('push', { repository: { full_name: 'example-org/not-subscribed', default_branch: 'main' }, ref: 'refs/heads/main', after: 's' }),
    undefined,
  );
  assert.equal(outcome.skipped, 'unknown_repo');
});
