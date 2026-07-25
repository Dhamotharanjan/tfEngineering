import test from 'node:test';
import assert from 'node:assert/strict';
import { GitHubNotifier } from '../notify/github-notifier.ts';
import { formatImpactPrComment, shouldPostPrComment } from '../notify/comment.ts';
import { verdictToConclusion, checkRunTitle } from '../notify/check-map.ts';
import { applyOverride } from '../app/override.ts';
import { makeHarness, moduleSub, consumerSub, contract, pinBumpFile, FAKE } from './harness.ts';
import { JobIntent } from '../domain/jobs.ts';
import { CheckVerdict, ImpactClass } from '../domain/classification.ts';
import type { ImpactReport } from '../domain/impact.ts';
import type { FetchLike } from '../integration/adapters/github-pr-files.ts';

type Captured = { method: string; url: string; body?: string };

function fakeFetch(capture: Captured[], responses: Record<string, { ok?: boolean; status?: number; json?: unknown }> = {}): FetchLike {
  return async (url, init) => {
    const method = (init?.method || 'GET').toUpperCase();
    capture.push({ method, url, body: init?.body });
    const key = `${method} ${url.includes('/check-runs') ? 'check' : url.includes('/comments') ? 'comment' : 'other'}`;
    const preset = responses[key] ?? { ok: true, status: 201, json: { id: 42 } };
    return {
      ok: preset.ok !== false,
      status: preset.status ?? 201,
      text: async () => '',
      json: async () => preset.json ?? { id: 42 },
    };
  };
}

function baseReport(overrides: Partial<ImpactReport> = {}): ImpactReport {
  return {
    reportId: 'rep-phase3',
    intent: JobIntent.PR_IMPACT_QUERY,
    moduleRepoId: FAKE.moduleId,
    fromVersion: FAKE.vFrom,
    toVersion: FAKE.vTo,
    prNumber: 9,
    prAuthor: 'octo-dev',
    headSha: FAKE.shaHead,
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

test('verdictToConclusion: PASS/WARN/BLOCK/silent map correctly', () => {
  assert.equal(verdictToConclusion(baseReport({ verdict: CheckVerdict.PASS })), 'success');
  assert.equal(verdictToConclusion(baseReport({ verdict: CheckVerdict.WARN })), 'neutral');
  assert.equal(verdictToConclusion(baseReport({ verdict: CheckVerdict.BLOCK })), 'failure');
  assert.equal(
    verdictToConclusion(baseReport({ silent: true, impactExists: false, verdict: CheckVerdict.PASS })),
    'success',
  );
  assert.equal(checkRunTitle(baseReport({ silent: true, impactExists: false })), 'No IaC impact');
});

test('shouldPostPrComment: silent → false', () => {
  assert.equal(shouldPostPrComment(baseReport({ silent: true, impactExists: false })), false);
  assert.equal(shouldPostPrComment(baseReport({ silent: false, impactExists: true })), true);
});

test('formatImpactPrComment: counts + file:line + deep link', () => {
  const body = formatImpactPrComment(
    baseReport({
      verdict: CheckVerdict.BLOCK,
      consumers: [
        {
          consumerRepoId: FAKE.consumerId,
          class: ImpactClass.BREAKING,
          evidence: {
            consumerRepoId: FAKE.consumerId,
            moduleId: FAKE.moduleId,
            currentPin: FAKE.vFrom,
            targetVersion: FAKE.vTo,
            providedInputs: [],
            breakingReasons: [],
            locations: [{ file: 'stacks/example/main.tf', line: 12 }],
          },
        },
        {
          consumerRepoId: 'example-other',
          class: ImpactClass.NON_BREAKING,
          evidence: {
            consumerRepoId: 'example-other',
            moduleId: FAKE.moduleId,
            currentPin: FAKE.vFrom,
            targetVersion: FAKE.vTo,
            providedInputs: [],
            breakingReasons: [],
            locations: [],
          },
        },
      ],
    }),
    [{ recipient: '@example-architect', role: 'architect', reason: 'disturbed', reportId: 'rep-phase3', deepLink: '/x' }],
    { deepLinkBaseUrl: 'https://infragraph.example.invalid', productLabel: 'InfraGraph Impact' },
  );
  assert.match(body, /Breaking \| 1/);
  assert.match(body, /Non-breaking \| 1/);
  assert.match(body, /stacks\/example\/main\.tf:12/);
  assert.match(body, /cc @example-architect/);
  assert.match(body, /impact\/reports\/rep-phase3/);
});

test('GitHubNotifier: silent → check success, no PR comment', async () => {
  const capture: Captured[] = [];
  const notifier = new GitHubNotifier({
    token: 't',
    fetch: fakeFetch(capture),
    checkName: 'InfraGraph Impact',
  });
  await notifier.publish({
    report: baseReport({ silent: true, impactExists: false, consumers: [], verdict: CheckVerdict.PASS }),
    repoFullName: FAKE.consumerGithub,
    notifications: [],
  });
  const checks = capture.filter((c) => c.url.includes('/check-runs'));
  const comments = capture.filter((c) => c.url.includes('/comments'));
  assert.equal(checks.length, 1);
  assert.equal(checks[0].method, 'POST');
  assert.match(checks[0].url, new RegExp(`/repos/${FAKE.consumerGithub.split('/')[0]}/`));
  const payload = JSON.parse(checks[0].body || '{}');
  assert.equal(payload.conclusion, 'success');
  assert.equal(comments.length, 0);
});

test('GitHubNotifier: breaking → fail check + PR comment', async () => {
  const capture: Captured[] = [];
  const notifier = new GitHubNotifier({
    token: 't',
    fetch: fakeFetch(capture),
    deepLinkBaseUrl: 'https://infragraph.example.invalid',
  });
  await notifier.publish({
    report: baseReport({
      verdict: CheckVerdict.BLOCK,
      consumers: [
        {
          consumerRepoId: FAKE.consumerId,
          class: ImpactClass.BREAKING,
          evidence: {
            consumerRepoId: FAKE.consumerId,
            moduleId: FAKE.moduleId,
            currentPin: FAKE.vFrom,
            targetVersion: FAKE.vTo,
            providedInputs: [],
            breakingReasons: [{ kind: 'new_required_missing', input: 'new_required' }],
            locations: [{ file: 'main.tf', line: 3 }],
          },
        },
      ],
    }),
    repoFullName: FAKE.consumerGithub,
    notifications: [],
  });
  const check = capture.find((c) => c.url.includes('/check-runs'));
  const comment = capture.find((c) => c.url.includes('/comments'));
  assert.ok(check);
  assert.equal(JSON.parse(check!.body || '{}').conclusion, 'failure');
  assert.ok(comment);
  const commentBody = JSON.parse(comment!.body || '{}').body as string;
  assert.match(commentBody, /BLOCK/);
  assert.match(commentBody, /Breaking \| 1/);
});

test('GitHubNotifier: non-breaking → pass check + short comment', async () => {
  const capture: Captured[] = [];
  const notifier = new GitHubNotifier({
    token: 't',
    fetch: fakeFetch(capture),
    deepLinkBaseUrl: '',
  });
  await notifier.publish({
    report: baseReport({
      verdict: CheckVerdict.PASS,
      consumers: [
        {
          consumerRepoId: FAKE.consumerId,
          class: ImpactClass.NON_BREAKING,
          evidence: {
            consumerRepoId: FAKE.consumerId,
            moduleId: FAKE.moduleId,
            currentPin: FAKE.vFrom,
            targetVersion: FAKE.vTo,
            providedInputs: ['required_a'],
            breakingReasons: [],
            locations: [{ file: 'main.tf', line: 2 }],
          },
        },
      ],
    }),
    repoFullName: FAKE.consumerGithub,
    notifications: [],
  });
  const check = capture.find((c) => c.url.includes('/check-runs'));
  const comment = capture.find((c) => c.url.includes('/comments'));
  assert.equal(JSON.parse(check!.body || '{}').conclusion, 'success');
  assert.ok(comment);
  const commentBody = JSON.parse(comment!.body || '{}').body as string;
  assert.match(commentBody, /PASS/);
  assert.match(commentBody, /Non-breaking \| 1/);
  assert.ok(commentBody.length < 1200);
});

test('engine + feedback: silent PR still publishes green check only', async () => {
  const h = makeHarness();
  const { MemoryImpactFeedback } = await import('../adapters/memory/index.ts');
  const feedback = new MemoryImpactFeedback();
  // Rebuild engine with feedback
  const { ImpactEngine } = await import('../impact/engine.ts');
  const engine = new ImpactEngine({
    graph: h.graph,
    subscriptions: h.subscriptions,
    contracts: h.contracts,
    watermarks: h.watermarks,
    patterns: h.patterns,
    reports: h.reports,
    jobs: h.jobs,
    notifier: h.notifier,
    feedback,
    narrator: h.narrator,
    config: h.config,
  });
  h.subscriptions.add(consumerSub());
  const report = await engine.runHotQuery({
    intent: JobIntent.PR_IMPACT_QUERY,
    repoId: FAKE.consumerId,
    headSha: FAKE.shaHead,
    prNumber: 3,
    files: [{ path: 'README.md', status: 'modified', newContent: '# hi' }],
  });
  assert.equal(report.silent, true);
  assert.equal(feedback.published.length, 1);
  assert.equal(feedback.published[0].report.silent, true);
  assert.equal(feedback.published[0].repoFullName, FAKE.consumerGithub);
  assert.equal(h.notifier.sent.length, 0);
});

test('applyOverride: republishes check when feedback + repoFullName provided', async () => {
  const h = makeHarness();
  h.subscriptions.add(moduleSub());
  h.subscriptions.add(consumerSub());
  await h.watermarks.setIndexedSha(FAKE.moduleId, FAKE.shaIndexed);
  await h.contracts.put(contract(FAKE.vFrom, [{ name: 'required_a' }]));
  await h.contracts.put(contract(FAKE.vTo, [{ name: 'required_a' }, { name: 'new_required' }]));
  h.graph.setConsumers(FAKE.moduleId, [
    {
      consumerRepoId: FAKE.consumerId,
      currentPin: FAKE.vFrom,
      providedInputs: ['required_a'],
      locations: [{ file: 'main.tf', line: 2 }],
    },
  ]);
  const report = await h.engine.runHotQuery({
    intent: JobIntent.PR_IMPACT_QUERY,
    repoId: FAKE.consumerId,
    headSha: FAKE.shaHead,
    prNumber: 11,
    files: [pinBumpFile(FAKE.vFrom, FAKE.vTo)],
  });
  assert.equal(report.verdict, CheckVerdict.BLOCK);

  const { MemoryImpactFeedback } = await import('../adapters/memory/index.ts');
  const feedback = new MemoryImpactFeedback();
  const overridden = await applyOverride(
    report,
    { actor: 'example-approver', reason: 'accepted risk' },
    {
      audit: h.audit,
      reports: h.reports,
      feedback,
      repoFullName: FAKE.consumerGithub,
    },
  );
  assert.equal(overridden.verdict, CheckVerdict.WARN);
  assert.equal(feedback.published.length, 1);
  assert.equal(feedback.published[0].report.verdict, CheckVerdict.WARN);
});
