# Phase 0 wiring — live API + worker

Status of connecting `platform/` (Impact Loop) into the running Nest API and Go
worker. Complements [README.md](./README.md) "Wiring seams" and [DECISIONS.md](./DECISIONS.md).

## What is wired

| Seam | Status |
|---|---|
| Webhook entry (`apps/api` → `ImpactLoop.handleWebhook(GitHubAdapter, …)`) | **Done.** `WebhooksController` delegates to `ImpactLoopService`. |
| PR `opened` / `synchronize` / `reopened` | **HOT** `pr_impact_query` — runs ImpactEngine **inline**. Never enqueues `incremental_scan`. |
| Push (default branch) | **WARM** `warm_incremental` → Redis `incremental_scan` (existing worker path). |
| Push (non-default branch) | Ignored (platform router). |
| Release / tag webhook | **HOT** `tag_impact_query` — inline ImpactEngine. No graph write. |
| `JobEnqueuer` | `QueueJobEnqueuer`: `cold_scan`→`full_scan`, `warm_incremental`→`incremental_scan`. HOT intents refused on the queue. |
| `SubscriptionReader` | `DbSubscriptionReader` over Postgres `subscriptions` (resolve by id / `github_full_name` / short name). No hardcoded repos. |
| Graph read (HOT) | `Neo4jGraphReader` + `NestCypherRunner` (read sessions only; `write()` throws). |
| Contracts | `PostgresContractStore` → `module_release_contracts`. |
| Worker hard-guard | `RefuseHotScanTrigger` in `runScan`; `pr_impact_query` / `tag_impact_query` job types refused in `ProcessJob`. |
| Manual `/webhooks/impact/trigger` | Still enqueues `mandatory_impact_analysis` for legacy UI; **requires** `to_version` (no `v2.4.2` / `v3.0.0` fallbacks). |
| Package dependency | `apps/api` depends on `@infragraph/platform` (`file:../../platform`); platform emits CJS `dist/` via `npm run build`. |

## What is stubbed / deferred

| Item | Gap | Next phase |
|---|---|---|
| Dual watermark `last_event_sha` | Column not added; `Phase0WatermarkStore.setLastEventSha` is a no-op. `indexed_sha` still = `subscriptions.last_scanned_sha`. | Phase 1 |
| `impact_reports` table | HOT reports land in `audit_log` summary rows via `Phase0ImpactReportStore`. | Phase 1 |
| Pattern stamps | `EmptyPatternStore` — no disturb notifications from live DB. | Phase 4 |
| Notifier | `LogNotifier` logs only; no Slack/email/GitHub check. | Phase 3 |
| Narrator | `TemplateNarrator` only (no AI service). | Phase 2/3 |
| PR file list | GitHub PR webhooks often omit file paths; HOT may be silent until files are fetched via GitHub API. | Phase 2 |
| Docker API image | `apps/api` Dockerfile build context does not yet copy `platform/`; local `npm install` builds the file dependency. Update compose/Dockerfile for image builds. | Phase 0 follow-up |
| Worker COLD/WARM | Unchanged — still owns parse + Neo4j/Postgres write + watermark advance. | — |

## Routing summary

```
push (default branch)  → ImpactLoop → enqueue incremental_scan     (WARM, writes graph)
pull_request           → ImpactLoop → ImpactEngine.runHotQuery     (HOT, read-only)
release (tag)          → ImpactLoop → ImpactEngine.runHotQuery     (HOT, read-only)
manual impact trigger  → mandatory_impact_analysis (legacy worker) when to_version supplied
```

## Tests

```bash
# Platform reference suite
cd platform && npm test

# Phase 0 live wiring contract (API)
cd apps/api && node --test src/platform/job-mapping.test.cjs

# Worker HOT guard
cd apps/worker && go test ./internal/pipeline/ -run RefuseHotScan -count=1
```

## Phase 1 next steps

1. Add `subscriptions.last_event_sha` + `impact_reports` DDL (small migration).
2. Fetch PR changed files when webhook payload lacks them.
3. Wire real Notifier + GitHub check/comment (Phase 3 can absorb).
4. Fix Docker build context so `@infragraph/platform` is available in the API image.
