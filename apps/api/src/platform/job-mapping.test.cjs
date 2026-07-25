/**
 * Phase 0 routing decision smoke test (no Nest bootstrap).
 * Run from apps/api: node --test src/platform/job-mapping.test.cjs
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  routeEvent,
  JobIntent,
  ExecutionPath,
  VcsEventKind,
} = require('@infragraph/platform');

/** Mirror of job-mapping.ts — kept here so the smoke test needs no TS loader. */
function platformIntentToWorkerType(intent) {
  switch (intent) {
    case 'cold_scan':
      return 'full_scan';
    case 'warm_incremental':
      return 'incremental_scan';
    default:
      return null;
  }
}

describe('Phase 0 platform routeEvent (live wiring contract)', () => {
  it('push default branch → warm_incremental → incremental_scan', () => {
    const job = routeEvent(
      {
        provider: 'github',
        kind: VcsEventKind.PUSH,
        repoFullName: 'example-org/example-repo',
        isDefaultBranch: true,
        headSha: 'h',
      },
      'example-repo',
    );
    assert.equal(job.intent, JobIntent.WARM_INCREMENTAL);
    assert.equal(job.path, ExecutionPath.WARM);
    assert.equal(platformIntentToWorkerType(job.intent), 'incremental_scan');
  });

  it('pull_request → pr_impact_query (HOT), never incremental_scan', () => {
    const job = routeEvent(
      {
        provider: 'github',
        kind: VcsEventKind.PULL_REQUEST,
        repoFullName: 'example-org/example-repo',
        prNumber: 1,
        headSha: 'h',
      },
      'example-repo',
    );
    assert.equal(job.intent, JobIntent.PR_IMPACT_QUERY);
    assert.equal(job.path, ExecutionPath.HOT);
    assert.equal(platformIntentToWorkerType(job.intent), null);
  });

  it('tag/release → tag_impact_query (HOT)', () => {
    const job = routeEvent(
      {
        provider: 'github',
        kind: VcsEventKind.TAG_RELEASE,
        repoFullName: 'example-org/example-repo',
        tag: 'v1.2.3',
      },
      'example-repo',
    );
    assert.equal(job.intent, JobIntent.TAG_IMPACT_QUERY);
    assert.equal(job.path, ExecutionPath.HOT);
    assert.equal(platformIntentToWorkerType(job.intent), null);
  });

  it('non-default-branch push is ignored', () => {
    const job = routeEvent(
      {
        provider: 'github',
        kind: VcsEventKind.PUSH,
        repoFullName: 'example-org/example-repo',
        isDefaultBranch: false,
        ref: 'refs/heads/feature',
      },
      'example-repo',
    );
    assert.equal(job, null);
  });
});
