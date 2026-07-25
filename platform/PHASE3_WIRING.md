# Phase 3 wiring — GitHub Check Runs + PR comments

Status of closing the GitHub loop after HOT PR impact: check runs, compact PR
comments, and a real `GitHubNotifier` behind the platform `Notifier` /
`ImpactFeedback` ports. Complements [PHASE2_WIRING.md](./PHASE2_WIRING.md) and
[DECISIONS.md](./DECISIONS.md).

## What Phase 3 wired

| Seam | Status |
|---|---|
| `ImpactFeedback` port | **Done.** `publish({ report, repoFullName, notifications })` — `repoFullName` from subscription only. |
| `GitHubNotifier` | **Done.** Implements `Notifier` + `ImpactFeedback`. Check Runs + PR comments via GitHub REST; injected `fetch` for offline tests. |
| Check Run mapping | **Done.** PASS → `success`, WARN → `neutral`, BLOCK → `failure`. Silent / no IaC → `success` (green, no noisy comment). |
| PR comment | **Done.** Compact summary: Breaking / Non-breaking / Unknown counts, key consumers with `file:line`, architect `cc` when DISTURBED + recipients resolved, deep link to `GET /impact/reports/:id`. |
| Silence rule | **Done.** `report.silent` / `!impactExists` → **no PR comment**; check may still complete green. |
| Recipient routing | **Unchanged.** Still `resolveRecipients` from subscription `contacts` + `PLATFORM_ARCHITECT_RECIPIENTS` / owner contact keys — **zero hardcoded org/repo/handles**. |
| Live API | **Done.** `ImpactLoopService` wires `GitHubNotifier.fromEnv` as both `notifier` and `feedback`. |
| Audited override → re-check | **Supported in platform.** `applyOverride` republishes when `feedback` + `repoFullName` are passed. **No HTTP override route in API yet** — wire when Phase 5 / admin UI lands (follow-up). |
| Slack webhook | **Skipped** (scope). GitHub is MVP. |

### HOT → GitHub feedback flow

```
ImpactEngine.runHotQuery
  → save impact_reports + last_event_sha only
  → resolveRecipients (contacts + architect roles)
  → ImpactFeedback.publish (GitHubNotifier)
       ├─ POST/PATCH /repos/{owner}/{repo}/check-runs
       │     owner/repo from Subscription.githubFullName
       │     conclusion from verdictToConclusion(report)
       └─ POST .../issues/{pr}/comments   (skipped when silent)
  → HOT never writes Neo4j / never advances indexed_sha
```

Env (also in `platform/.env.example`):

| Variable | Purpose |
|---|---|
| `GITHUB_TOKEN` / `GH_TOKEN` | Auth for Check Runs + comments (and Phase 2 PR file fetch) |
| `GITHUB_HOST` | GHE host when not github.com |
| `PLATFORM_GITHUB_CHECK_NAME` | Check run display name (default `InfraGraph Impact`) |
| `PLATFORM_DEEP_LINK_BASE_URL` | Absolute links in PR comments |
| `PLATFORM_ARCHITECT_RECIPIENTS` | Architect mentions when pattern DISTURBED |
| `PLATFORM_OWNER_CONTACT_KEYS` | Which subscription contact keys identify owners |

**Zero hardcoded repo/org/module/version/owner strings** in runtime code.

## Tests

```bash
# Platform (includes Phase 3 GitHub notify suite)
cd platform && npm test

# API Phase 0–3 wiring contracts (no live DB / GitHub)
cd apps/api && npm run test:phase3

# API typecheck/build
cd apps/api && npm run build
```

## Phase 2 items resolved by Phase 3

| Prior stub | Resolution |
|---|---|
| `LogNotifier` only | `GitHubNotifier` on live HOT path |
| No check run / PR comment | Check Runs + silence-aware PR comments |

## What remains for Phase 4+

| Item | Gap | Next phase |
|---|---|---|
| Pattern stamps / disturb | `EmptyPatternStore` — architect notify path exists but no live stamps | **Phase 4** |
| HTTP audited override + check re-run | `applyOverride` supports feedback republish; API route not exposed | Phase 5 / follow-up |
| Slack / email adapters | Recipients resolved; delivery is GitHub (log fallback for non-PR) | Optional |
| Richer HOT Neo4j fan-out e2e | Engine paths exist; live depth | Follow-up |

## Constraints still in force

- HOT never writes Neo4j and never advances `indexed_sha` / `indexed_at`
- AI never decides BREAKING / NON_BREAKING — class is classifier-owned
- No fake hash embeddings for narration
- No spam comments when nothing IaC-relevant changed
