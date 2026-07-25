/**
 * Phase 2 wiring contract: PR file fetch resolve policy + narrator env factory
 * (no Nest bootstrap / no live GitHub / no live AI).
 * Run: node --test src/platform/phase2-wiring.test.cjs
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  resolvePrFiles,
  GitHubPrFileFetcher,
  createNarratorFromEnv,
  TemplateNarrator,
  HttpAiNarrator,
  VcsEventKind,
  ImpactClass,
  buildNarrationUserPayload,
} = require('@infragraph/platform');

describe('Phase 2 resolvePrFiles policy', () => {
  it('keeps payload files and does not call fetcher', async () => {
    let calls = 0;
    const fetcher = {
      fetchChangedFiles: async () => {
        calls += 1;
        return { ok: true, files: [{ path: 'nope.tf' }] };
      },
    };
    const out = await resolvePrFiles(
      {
        provider: 'github',
        kind: VcsEventKind.PULL_REQUEST,
        repoFullName: 'example-org/example-repo',
        prNumber: 1,
        files: [{ path: 'main.tf', status: 'modified' }],
      },
      fetcher,
    );
    assert.equal(calls, 0);
    assert.equal(out.fetched, false);
    assert.equal(out.event.files[0].path, 'main.tf');
  });

  it('fetches when payload omits files', async () => {
    const out = await resolvePrFiles(
      {
        provider: 'github',
        kind: VcsEventKind.PULL_REQUEST,
        repoFullName: 'example-org/example-repo',
        prNumber: 2,
      },
      {
        fetchChangedFiles: async (req) => {
          assert.equal(req.repoFullName, 'example-org/example-repo');
          assert.equal(req.prNumber, 2);
          return { ok: true, files: [{ path: 'stack/main.tf', status: 'modified' }] };
        },
      },
    );
    assert.equal(out.fetched, true);
    assert.equal(out.event.files.length, 1);
  });

  it('on fetch failure leaves empty files (silent policy, no invented paths)', async () => {
    const out = await resolvePrFiles(
      {
        provider: 'github',
        kind: VcsEventKind.PULL_REQUEST,
        repoFullName: 'example-org/example-repo',
        prNumber: 3,
        files: [],
      },
      {
        fetchChangedFiles: async () => ({ ok: false, reason: 'http_error', status: 500 }),
      },
    );
    assert.equal(out.fetchFailed, true);
    assert.deepEqual(out.event.files, []);
  });
});

describe('Phase 2 narrator factory', () => {
  it('createNarratorFromEnv without URL → TemplateNarrator', () => {
    const n = createNarratorFromEnv({});
    assert.ok(n instanceof TemplateNarrator);
  });

  it('createNarratorFromEnv with AI_SERVICE_URL → HttpAiNarrator that echoes class', async () => {
    const n = createNarratorFromEnv(
      { AI_SERVICE_URL: 'http://ai.example.invalid' },
      {
        fetch: async () => ({
          ok: true,
          status: 200,
          json: async () => ({
            class: ImpactClass.BREAKING,
            headline: 'ok headline',
            detail: 'ok detail from evidence',
          }),
        }),
      },
    );
    assert.ok(n instanceof HttpAiNarrator);
    const narration = await n.narrate({
      class: ImpactClass.NON_BREAKING,
      evidence: {
        consumerRepoId: 'c',
        moduleId: 'm',
        currentPin: 'v1',
        targetVersion: 'v2',
        providedInputs: [],
        contractDiff: null,
        breakingReasons: [],
        locations: [],
      },
    });
    assert.equal(narration.class, ImpactClass.NON_BREAKING);
    assert.equal(narration.source, 'llm');
  });

  it('GitHubPrFileFetcher.fromEnv uses injected fetch (offline)', async () => {
    const fetcher = GitHubPrFileFetcher.fromEnv(
      { GITHUB_TOKEN: 'x', GITHUB_HOST: 'github.com' },
      {
        fetch: async (url) => {
          assert.match(url, /api\.github\.com\/repos\/ex-org\/ex-repo\/pulls\/9\/files/);
          return {
            ok: true,
            status: 200,
            text: async () => '',
            json: async () => [{ filename: 'a.tf', status: 'modified' }],
          };
        },
        includeContents: false,
      },
    );
    const result = await fetcher.fetchChangedFiles({
      repoFullName: 'ex-org/ex-repo',
      prNumber: 9,
    });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.files[0].path, 'a.tf');
  });

  it('narration payload contract has no invented class fields beyond evidence', () => {
    const payload = buildNarrationUserPayload({
      class: ImpactClass.UNKNOWN,
      evidence: {
        consumerRepoId: 'c',
        moduleId: 'm',
        currentPin: null,
        targetVersion: 't',
        providedInputs: [],
        contractDiff: null,
        breakingReasons: [],
        locations: [],
      },
    });
    assert.equal(payload.class, ImpactClass.UNKNOWN);
    assert.equal(payload.contract_diff_summary, null);
  });
});
