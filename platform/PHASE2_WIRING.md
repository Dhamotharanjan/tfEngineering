# Phase 2 wiring — PR file fetch + evidence-only AI narrator

Status of making HOT PR impact work against real GitHub webhooks (which usually
omit changed-file lists) and grounding narration in the AI service with a
deterministic fallback. Complements [PHASE1_WIRING.md](./PHASE1_WIRING.md) and
[DECISIONS.md](./DECISIONS.md).

## What Phase 2 wired

| Seam | Status |
|---|---|
| `PrFileFetcher` port + `resolvePrFiles` | **Done.** When a `pull_request` event has empty/missing `files`, HOT calls the fetcher before the engine runs. |
| `GitHubPrFileFetcher` | **Done.** `GET /repos/{owner}/{repo}/pulls/{n}/files`; optional base/head blob contents for pin-delta. Auth via `GITHUB_TOKEN` / `GH_TOKEN`; API host via `GITHUB_HOST` (GHE). Injected `fetch` for offline tests. |
| Fetch failure policy | **Done.** Failed / missing fetch → empty `files` → HOT **silent** report. **No invented paths.** Never fabricates UNKNOWN from fake files. |
| Payload already has files | **Done.** Fetcher is not called; webhook paths win. |
| `HttpAiNarrator` + `createNarratorFromEnv` | **Done.** POSTs `NARRATION_SYSTEM_PROMPT` + `buildNarrationUserPayload` to `{AI_SERVICE_URL}/impact/narrate`. Always echoes classifier `class`. Missing URL / HTTP failure → `TemplateNarrator`. |
| AI service `/impact/narrate` | **Done.** Evidence-only formatter in `services/ai/impact_narrate.py` — **no embeddings / no Milvus**. |
| `ImpactLoop` + `ImpactLoopService` | **Done.** Live PR HOT path uses `GitHubPrFileFetcher.fromEnv` + `createNarratorFromEnv`. |
| HOT write guard | **Unchanged.** Still never writes Neo4j / never advances `indexed_sha`. |

### PR file fetch flow

```
pull_request webhook
  → GitHubAdapter.normalize  (files usually undefined — no commits[] on PR payloads)
  → ImpactLoop.resolvePrFiles
       ├─ files already present → use as-is
       ├─ omit/empty + fetcher  → GitHub API list (+ optional contents)
       └─ fetch fails           → files=[] → silent HOT (no invented paths)
  → ImpactEngine.runHotQuery (pin delta / classify / narrate)
  → impact_reports + last_event_sha only
```

### Narrator flow

```
ImpactEngine.classify → class + evidence
  → narrator.narrate({ class, evidence })
       ├─ AI_SERVICE_URL / PLATFORM_AI_SERVICE_URL set
       │     → POST /impact/narrate (evidence-only body)
       │     → on success: headline/detail from AI, class ALWAYS echoed
       │     → on HTTP/empty → TemplateNarrator
       └─ unset → TemplateNarrator
```

Env (documented in `platform/.env.example`):

- `GITHUB_TOKEN` / `GH_TOKEN` — optional for public repos; required for private
- `GITHUB_HOST` — GHE host when not github.com
- `AI_SERVICE_URL` / `PLATFORM_AI_SERVICE_URL` — AI narrator base URL

**Zero hardcoded repo/org/module/version strings** in runtime code.

## Tests

```bash
# Platform (includes Phase 2 PR-files + narrator suite)
cd platform && npm test

# API Phase 0–2 wiring contracts (no live DB / GitHub / AI)
cd apps/api && npm run test:phase2

# API typecheck/build
cd apps/api && npm run build
```

## Phase 0 / 1 items resolved by Phase 2

| Prior stub | Resolution |
|---|---|
| PR file list fetch (webhook omits paths) | `GitHubPrFileFetcher` + `resolvePrFiles` on HOT PR path |
| Narrator = `TemplateNarrator` only | `HttpAiNarrator` with Template fallback; AI `/impact/narrate` |

## What remains for Phase 3+

| Item | Gap | Next phase |
|---|---|---|
| GitHub Check + PR comment | `LogNotifier` only — no check run / comment | **Phase 3** |
| Richer notify (Slack/email) | Recipients resolved; delivery is log-only | Phase 3 |
| Pattern stamps / disturb | `EmptyPatternStore` | Phase 4 |
| Docker API image copies `platform/` | **Done by sibling** — see [DOCKER_BUILD.md](./DOCKER_BUILD.md) | — |
| Optional: richer HOT Neo4j fan-out e2e | Engine paths exist; live contracts+graph depth | Phase 2 follow-up / 3 |
| LLM behind `/impact/narrate` | Endpoint is deterministic evidence formatter today | Optional later |

## Constraints still in force

- HOT never writes Neo4j and never advances `indexed_sha` / `indexed_at`
- AI never decides BREAKING / NON_BREAKING — class is classifier-owned
- No fake hash embeddings for narration
