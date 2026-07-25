import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvePrFiles } from '../integration/pr-files.ts';
import type { PrFileFetcher, PrFileFetchResult } from '../integration/pr-files.ts';
import { GitHubPrFileFetcher } from '../integration/adapters/github-pr-files.ts';
import type { NormalizedVcsEvent, FileChange } from '../domain/events.ts';
import { VcsEventKind } from '../domain/events.ts';
import { ImpactLoop } from '../app/impact-loop.ts';
import { GitHubAdapter } from '../integration/adapters/github.ts';
import { makeHarness, moduleSub, consumerSub, contract, FAKE, pinBumpFile } from './harness.ts';
import { JobIntent } from '../domain/jobs.ts';
import { ImpactClass } from '../domain/classification.ts';
import { HttpAiNarrator, createNarratorFromEnv } from '../narration/http-ai.ts';
import { TemplateNarrator } from '../narration/template.ts';
import { buildNarrationUserPayload } from '../narration/port.ts';

function prEvent(overrides: Partial<NormalizedVcsEvent> = {}): NormalizedVcsEvent {
  return {
    provider: 'github',
    kind: VcsEventKind.PULL_REQUEST,
    repoFullName: FAKE.consumerGithub,
    prNumber: 7,
    headSha: 'sha-head',
    baseSha: 'sha-base',
    ...overrides,
  };
}

function rawWebhook(event: string, body: unknown) {
  return { headers: { 'x-github-event': event, 'x-github-delivery': 'd-phase2' }, rawBody: JSON.stringify(body), body };
}

class FakeFetcher implements PrFileFetcher {
  calls = 0;
  private readonly result: PrFileFetchResult | (() => Promise<PrFileFetchResult>);
  constructor(result: PrFileFetchResult | (() => Promise<PrFileFetchResult>)) {
    this.result = result;
  }
  async fetchChangedFiles(): Promise<PrFileFetchResult> {
    this.calls += 1;
    return typeof this.result === 'function' ? this.result() : this.result;
  }
}

test('resolvePrFiles: payload already has files → no fetch', async () => {
  const files: FileChange[] = [{ path: 'main.tf', status: 'modified' }];
  const fetcher = new FakeFetcher({ ok: true, files: [{ path: 'should-not-use.tf' }] });
  const out = await resolvePrFiles(prEvent({ files }), fetcher);
  assert.equal(fetcher.calls, 0);
  assert.equal(out.fetched, false);
  assert.equal(out.fetchFailed, false);
  assert.deepEqual(out.event.files, files);
});

test('resolvePrFiles: payload omits files → fetch and map', async () => {
  const fetched: FileChange[] = [
    { path: 'stacks/a.tf', status: 'modified', previousContent: 'old', newContent: 'new' },
  ];
  const fetcher = new FakeFetcher({ ok: true, files: fetched });
  const out = await resolvePrFiles(prEvent({ files: undefined }), fetcher);
  assert.equal(fetcher.calls, 1);
  assert.equal(out.fetched, true);
  assert.equal(out.fetchFailed, false);
  assert.deepEqual(out.event.files, fetched);
});

test('resolvePrFiles: fetch fails → empty files, no invented paths', async () => {
  const fetcher = new FakeFetcher({ ok: false, reason: 'http_error', status: 502 });
  const out = await resolvePrFiles(prEvent({ files: [] }), fetcher);
  assert.equal(out.fetched, false);
  assert.equal(out.fetchFailed, true);
  assert.deepEqual(out.event.files, []);
});

test('resolvePrFiles: fetcher throws → empty files, fetchFailed', async () => {
  const fetcher = new FakeFetcher(async () => {
    throw new Error('network down');
  });
  const out = await resolvePrFiles(prEvent({ files: undefined }), fetcher);
  assert.equal(out.fetchFailed, true);
  assert.deepEqual(out.event.files, []);
});

test('GitHubPrFileFetcher: lists PR files via API and maps to FileChange', async () => {
  const calls: string[] = [];
  const fetchFake = async (url: string) => {
    calls.push(url);
    if (url.includes('/pulls/3/files')) {
      return {
        ok: true,
        status: 200,
        text: async () => '',
        json: async () => [
          { filename: 'infra/main.tf', status: 'modified' },
          { filename: 'README.md', status: 'added' },
        ],
      };
    }
    if (url.includes('/contents/infra/main.tf') && url.includes('ref=base')) {
      return {
        ok: true,
        status: 200,
        text: async () => '',
        json: async () => ({
          encoding: 'base64',
          content: Buffer.from('source = "mod?ref=v1"\n').toString('base64'),
        }),
      };
    }
    if (url.includes('/contents/infra/main.tf') && url.includes('ref=head')) {
      return {
        ok: true,
        status: 200,
        text: async () => '',
        json: async () => ({
          encoding: 'base64',
          content: Buffer.from('source = "mod?ref=v2"\n').toString('base64'),
        }),
      };
    }
    if (url.includes('/contents/README.md')) {
      return {
        ok: true,
        status: 200,
        text: async () => '',
        json: async () => ({ encoding: 'base64', content: Buffer.from('# hi\n').toString('base64') }),
      };
    }
    return { ok: false, status: 404, text: async () => '', json: async () => ({}) };
  };

  const fetcher = new GitHubPrFileFetcher({
    token: 'test-token',
    apiBaseUrl: 'https://api.example.invalid',
    fetch: fetchFake,
  });
  const result = await fetcher.fetchChangedFiles({
    repoFullName: 'example-org/example-repo',
    prNumber: 3,
    baseSha: 'base',
    headSha: 'head',
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.files.length, 2);
  assert.equal(result.files[0].path, 'infra/main.tf');
  assert.equal(result.files[0].previousContent, 'source = "mod?ref=v1"\n');
  assert.equal(result.files[0].newContent, 'source = "mod?ref=v2"\n');
  assert.ok(calls[0].includes('/repos/example-org/example-repo/pulls/3/files'));
  assert.ok(calls.every((u) => !u.toLowerCase().includes('token')));
});

test('GitHubPrFileFetcher: HTTP failure returns ok:false (no invented paths)', async () => {
  const fetcher = new GitHubPrFileFetcher({
    apiBaseUrl: 'https://api.example.invalid',
    fetch: async () => ({ ok: false, status: 403, text: async () => '', json: async () => ({}) }),
  });
  const result = await fetcher.fetchChangedFiles({
    repoFullName: 'example-org/example-repo',
    prNumber: 1,
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, 'http_error');
  assert.equal(result.status, 403);
});

test('loop: PR without files uses fetcher then runs HOT with pin delta', async () => {
  const h = makeHarness();
  h.subscriptions.add(moduleSub());
  h.subscriptions.add(consumerSub());
  await h.watermarks.setIndexedSha(FAKE.moduleId, FAKE.shaIndexed);
  await h.contracts.put(contract(FAKE.vFrom, [{ name: 'a' }]));
  await h.contracts.put(contract(FAKE.vTo, [{ name: 'a' }]));
  h.graph.setConsumers(FAKE.moduleId, [
    {
      consumerRepoId: FAKE.consumerId,
      currentPin: FAKE.vFrom,
      providedInputs: ['a'],
      locations: [{ file: 'stacks/example/main.tf', line: 2 }],
    },
  ]);

  const bump = pinBumpFile(FAKE.vFrom, FAKE.vTo);
  const fetcher = new FakeFetcher({ ok: true, files: [bump] });
  const loop = new ImpactLoop({
    subscriptions: h.subscriptions,
    jobs: h.jobs,
    engine: h.engine,
    config: h.config,
    prFileFetcher: fetcher,
  });

  const outcome = await loop.handleWebhook(
    new GitHubAdapter(),
    rawWebhook('pull_request', {
      action: 'opened',
      number: 9,
      repository: { full_name: FAKE.consumerGithub },
      pull_request: { head: { sha: FAKE.shaHead }, base: { sha: FAKE.shaIndexed }, user: { login: 'dev' } },
    }),
    undefined,
  );

  assert.equal(fetcher.calls, 1);
  assert.equal(outcome.job?.intent, JobIntent.PR_IMPACT_QUERY);
  assert.ok(outcome.report);
  assert.equal(outcome.report.silent, false);
  assert.equal(outcome.report.consumers[0]?.class, ImpactClass.NON_BREAKING);
});

test('loop: fetch failure → silent HOT report, no invented paths', async () => {
  const h = makeHarness();
  h.subscriptions.add(moduleSub());
  h.subscriptions.add(consumerSub());
  const fetcher = new FakeFetcher({ ok: false, reason: 'http_error', status: 500 });
  const loop = new ImpactLoop({
    subscriptions: h.subscriptions,
    jobs: h.jobs,
    engine: h.engine,
    config: h.config,
    prFileFetcher: fetcher,
  });
  const outcome = await loop.handleWebhook(
    new GitHubAdapter(),
    rawWebhook('pull_request', {
      action: 'synchronize',
      number: 2,
      repository: { full_name: FAKE.consumerGithub },
      pull_request: { head: { sha: 'h' }, base: { sha: 'b' }, user: { login: 'dev' } },
    }),
    undefined,
  );
  assert.equal(fetcher.calls, 1);
  assert.ok(outcome.report);
  assert.equal(outcome.report.silent, true);
  assert.equal(outcome.report.consumers.length, 0);
});

test('HttpAiNarrator: uses AI response but always echoes classifier class', async () => {
  const narrator = new HttpAiNarrator({
    baseUrl: 'http://ai.example.invalid',
    fetch: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        class: ImpactClass.BREAKING, // LLM tries to flip — must be ignored
        headline: 'Compatible pin bump',
        detail: 'Evidence shows optional input added only.',
      }),
    }),
  });
  const n = await narrator.narrate({
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
  assert.equal(n.class, ImpactClass.NON_BREAKING);
  assert.equal(n.source, 'llm');
  assert.match(n.headline, /Compatible/);
});

test('HttpAiNarrator: HTTP failure falls back to TemplateNarrator', async () => {
  const narrator = new HttpAiNarrator({
    baseUrl: 'http://ai.example.invalid',
    fetch: async () => ({ ok: false, status: 503, json: async () => ({}) }),
  });
  const n = await narrator.narrate({
    class: ImpactClass.UNKNOWN,
    evidence: {
      consumerRepoId: 'c',
      moduleId: 'm',
      currentPin: null,
      targetVersion: 'v2',
      providedInputs: [],
      contractDiff: null,
      breakingReasons: [],
      locations: [],
      staleness: { stale: true, reason: 'missing_contract' },
    },
  });
  assert.equal(n.source, 'template');
  assert.equal(n.class, ImpactClass.UNKNOWN);
});

test('createNarratorFromEnv: missing URL → TemplateNarrator', async () => {
  const n = createNarratorFromEnv({});
  assert.ok(n instanceof TemplateNarrator);
});

test('createNarratorFromEnv: configured URL → HttpAiNarrator that posts evidence-only payload', async () => {
  let posted: unknown;
  const n = createNarratorFromEnv(
    { AI_SERVICE_URL: 'http://ai.example.invalid' },
    {
      fetch: async (_url, init) => {
        posted = JSON.parse(String(init?.body || '{}'));
        return {
          ok: true,
          status: 200,
          json: async () => ({ headline: 'H', detail: 'D' }),
        };
      },
    },
  );
  assert.ok(n instanceof HttpAiNarrator);
  await n.narrate({
    class: ImpactClass.BREAKING,
    evidence: {
      consumerRepoId: 'c',
      moduleId: 'm',
      currentPin: 'v1',
      targetVersion: 'v2',
      providedInputs: ['x'],
      contractDiff: null,
      breakingReasons: [{ kind: 'removed_input_in_use', input: 'x' }],
      locations: [{ file: 'a.tf', line: 1 }],
    },
  });
  const body = posted as { system: string; evidence: Record<string, unknown> };
  assert.ok(body.system.includes('MUST NOT change the CLASS'));
  assert.deepEqual(Object.keys(body.evidence).sort(), Object.keys(buildNarrationUserPayload({
    class: ImpactClass.BREAKING,
    evidence: {
      consumerRepoId: 'c',
      moduleId: 'm',
      currentPin: 'v1',
      targetVersion: 'v2',
      providedInputs: ['x'],
      contractDiff: null,
      breakingReasons: [],
      locations: [],
    },
  })).sort());
});
