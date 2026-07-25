/**
 * Phase 3 wiring contract: GitHub check conclusion map + comment silence rule
 * + GitHubNotifier offline HTTP (no Nest / no live GitHub).
 * Run: node --test src/platform/phase3-wiring.test.cjs
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  verdictToConclusion,
  shouldPostPrComment,
  formatImpactPrComment,
  GitHubNotifier,
  CheckVerdict,
  ImpactClass,
  JobIntent,
} = require('@infragraph/platform');

function report(overrides = {}) {
  return {
    reportId: 'rep-api-p3',
    intent: JobIntent.PR_IMPACT_QUERY,
    moduleRepoId: 'example-module',
    fromVersion: 'v1',
    toVersion: 'v2',
    prNumber: 4,
    headSha: 'abc123',
    impactExists: true,
    silent: false,
    consumers: [],
    patternChecks: [],
    verdict: CheckVerdict.PASS,
    refreshEnqueued: [],
    generatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('Phase 3 check + comment policy', () => {
  it('maps verdicts to GitHub conclusions', () => {
    assert.equal(verdictToConclusion(report({ verdict: CheckVerdict.PASS })), 'success');
    assert.equal(verdictToConclusion(report({ verdict: CheckVerdict.WARN })), 'neutral');
    assert.equal(verdictToConclusion(report({ verdict: CheckVerdict.BLOCK })), 'failure');
    assert.equal(
      verdictToConclusion(report({ silent: true, impactExists: false })),
      'success',
    );
  });

  it('silence rule skips PR comments', () => {
    assert.equal(shouldPostPrComment(report({ silent: true, impactExists: false })), false);
    assert.equal(shouldPostPrComment(report()), true);
  });

  it('comment formatter includes class counts and deep link', () => {
    const body = formatImpactPrComment(
      report({
        verdict: CheckVerdict.BLOCK,
        consumers: [
          {
            consumerRepoId: 'example-consumer',
            class: ImpactClass.BREAKING,
            evidence: {
              consumerRepoId: 'example-consumer',
              moduleId: 'example-module',
              currentPin: 'v1',
              targetVersion: 'v2',
              providedInputs: [],
              breakingReasons: [],
              locations: [{ file: 'main.tf', line: 8 }],
            },
          },
        ],
      }),
      [],
      { deepLinkBaseUrl: 'https://infragraph.example.invalid' },
    );
    assert.match(body, /Breaking \| 1/);
    assert.match(body, /main\.tf:8/);
    assert.match(body, /impact\/reports\/rep-api-p3/);
  });
});

describe('Phase 3 GitHubNotifier offline', () => {
  it('silent → check only; breaking → fail + comment', async () => {
    const calls = [];
    const fetch = async (url, init) => {
      calls.push({ url, method: init?.method, body: init?.body });
      return {
        ok: true,
        status: 201,
        text: async () => '',
        json: async () => ({ id: 7 }),
      };
    };
    const n = new GitHubNotifier({ token: 'x', fetch, deepLinkBaseUrl: '' });

    await n.publish({
      report: report({ silent: true, impactExists: false }),
      repoFullName: 'example-org/example-repo',
      notifications: [],
    });
    assert.equal(calls.filter((c) => c.url.includes('/check-runs')).length, 1);
    assert.equal(calls.filter((c) => c.url.includes('/comments')).length, 0);
    assert.equal(JSON.parse(calls[0].body).conclusion, 'success');

    calls.length = 0;
    await n.publish({
      report: report({
        verdict: CheckVerdict.BLOCK,
        consumers: [
          {
            consumerRepoId: 'c1',
            class: ImpactClass.BREAKING,
            evidence: {
              consumerRepoId: 'c1',
              moduleId: 'm',
              currentPin: null,
              targetVersion: 'v2',
              providedInputs: [],
              breakingReasons: [],
              locations: [],
            },
          },
        ],
      }),
      repoFullName: 'example-org/example-repo',
      notifications: [],
    });
    assert.equal(JSON.parse(calls.find((c) => c.url.includes('/check-runs')).body).conclusion, 'failure');
    assert.ok(calls.some((c) => c.url.includes('/comments')));
  });

  it('check run 403 → commit status fallback; 201 → no status', async () => {
    const calls = [];
    const fetch = async (url, init) => {
      calls.push({ url, method: init?.method, body: init?.body });
      if (String(url).includes('/check-runs')) {
        return { ok: false, status: 403, text: async () => '', json: async () => ({}) };
      }
      return { ok: true, status: 201, text: async () => '', json: async () => ({ id: 1 }) };
    };
    const n = new GitHubNotifier({
      token: 'x',
      fetch,
      checkName: 'InfraGraph Impact',
      deepLinkBaseUrl: 'https://infragraph.example.invalid',
    });
    await n.publish({
      report: report({ verdict: CheckVerdict.WARN }),
      repoFullName: 'example-org/example-repo',
      notifications: [],
    });
    assert.ok(calls.some((c) => c.url.includes('/check-runs')));
    const statusCall = calls.find((c) => c.url.includes('/statuses/'));
    assert.ok(statusCall);
    const body = JSON.parse(statusCall.body);
    assert.equal(body.state, 'success');
    assert.equal(body.context, 'InfraGraph Impact');
    assert.match(body.description, /^WARN:/);

    calls.length = 0;
    const okFetch = async (url, init) => {
      calls.push({ url, method: init?.method, body: init?.body });
      return { ok: true, status: 201, text: async () => '', json: async () => ({ id: 2 }) };
    };
    const n2 = new GitHubNotifier({ token: 'x', fetch: okFetch });
    await n2.publish({
      report: report({ verdict: CheckVerdict.PASS }),
      repoFullName: 'example-org/example-repo',
      notifications: [],
    });
    assert.equal(calls.filter((c) => c.url.includes('/check-runs')).length, 1);
    assert.equal(calls.filter((c) => c.url.includes('/statuses/')).length, 0);
  });
});
