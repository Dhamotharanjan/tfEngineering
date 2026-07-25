import test from 'node:test';
import assert from 'node:assert/strict';
import { GitHubAdapter } from '../integration/adapters/github.ts';
import { GitLabAdapter, AzureDevOpsAdapter, BitbucketAdapter } from '../integration/adapters/stubs.ts';
import { NotImplementedProviderError } from '../integration/provider.ts';
import { routeEvent, coldScanIntent } from '../integration/router.ts';
import { JobIntent } from '../domain/jobs.ts';
import { ExecutionPath } from '../domain/paths.ts';
import { VcsEventKind } from '../domain/events.ts';
import { createHmac } from 'node:crypto';

const gh = new GitHubAdapter();

function raw(event: string, body: unknown, extraHeaders: Record<string, string> = {}) {
  const rawBody = JSON.stringify(body);
  return {
    headers: { 'x-github-event': event, 'x-github-delivery': 'delivery-1', ...extraHeaders },
    rawBody,
    body,
  };
}

test('push to default branch routes to WARM warm_incremental', () => {
  const event = gh.normalize(
    raw('push', {
      repository: { full_name: 'example-org/example-repo', default_branch: 'main' },
      ref: 'refs/heads/main',
      after: 'sha-after',
      before: 'sha-before',
      commits: [{ modified: ['main.tf'] }],
    }),
  );
  assert.ok(event);
  const job = routeEvent(event, 'internal-repo-id');
  assert.ok(job);
  assert.equal(job.intent, JobIntent.WARM_INCREMENTAL);
  assert.equal(job.path, ExecutionPath.WARM);
});

test('push to non-default branch is ignored (WARM tracks default branch only)', () => {
  const event = gh.normalize(
    raw('push', {
      repository: { full_name: 'example-org/example-repo', default_branch: 'main' },
      ref: 'refs/heads/feature-x',
      after: 'sha',
    }),
  );
  assert.ok(event);
  assert.equal(routeEvent(event, 'internal-repo-id'), null);
});

test('pull_request routes to HOT pr_impact_query and NEVER to a graph-writing scan', () => {
  const event = gh.normalize(
    raw('pull_request', {
      action: 'opened',
      number: 7,
      repository: { full_name: 'example-org/example-repo' },
      pull_request: { head: { sha: 'head-sha' }, base: { sha: 'base-sha' }, user: { login: 'octo-dev' } },
    }),
  );
  assert.ok(event);
  const job = routeEvent(event, 'internal-repo-id');
  assert.ok(job);
  // The core doctrine + the apps/api bug fix: PR is HOT, read-only.
  assert.equal(job.intent, JobIntent.PR_IMPACT_QUERY);
  assert.equal(job.path, ExecutionPath.HOT);
  assert.notEqual(job.intent, JobIntent.COLD_SCAN);
  assert.notEqual(job.intent, JobIntent.WARM_INCREMENTAL);
});

test('release tag routes to HOT tag_impact_query', () => {
  const event = gh.normalize(
    raw('release', {
      repository: { full_name: 'example-org/example-repo' },
      release: { tag_name: 'example-v2', name: 'Example v2', body: 'notes', target_commitish: 'tgt-sha' },
    }),
  );
  assert.ok(event);
  assert.equal(event.kind, VcsEventKind.TAG_RELEASE);
  const job = routeEvent(event, 'internal-repo-id');
  assert.ok(job);
  assert.equal(job.intent, JobIntent.TAG_IMPACT_QUERY);
  assert.equal(job.path, ExecutionPath.HOT);
  assert.equal(job.payload.toVersion, 'example-v2');
});

test('subscribe maps to COLD cold_scan', () => {
  const job = coldScanIntent('internal-repo-id');
  assert.equal(job.intent, JobIntent.COLD_SCAN);
  assert.equal(job.path, ExecutionPath.COLD);
});

test('closed pull_request is not routed', () => {
  const event = gh.normalize(
    raw('pull_request', { action: 'closed', repository: { full_name: 'x/y' }, pull_request: {} }),
  );
  assert.equal(event, null);
});

test('github signature verification passes for a valid signature and fails otherwise', () => {
  const body = { repository: { full_name: 'x/y' }, ref: 'refs/heads/main' };
  const rawBody = JSON.stringify(body);
  const secret = 'example-secret';
  const digest = 'sha256=' + createHmac('sha256', secret).update(rawBody).digest('hex');
  const good = { headers: { 'x-github-event': 'push', 'x-hub-signature-256': digest }, rawBody, body };
  assert.doesNotThrow(() => gh.verifySignature(good, secret));

  const bad = { ...good, headers: { ...good.headers, 'x-hub-signature-256': 'sha256=deadbeef' } };
  assert.throws(() => gh.verifySignature(bad, secret));
});

test('provider stubs are clean seams that throw NotImplemented (never fake success)', () => {
  for (const adapter of [new GitLabAdapter(), new AzureDevOpsAdapter(), new BitbucketAdapter()]) {
    assert.throws(() => adapter.normalize({ headers: {}, rawBody: '', body: {} }), NotImplementedProviderError);
    assert.throws(() => adapter.verifySignature({ headers: {}, rawBody: '', body: {} }, 'x'), NotImplementedProviderError);
  }
});
