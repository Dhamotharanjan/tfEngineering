# Phase 1 wiring — dual watermark + durable HOT reports

Status of connecting the dual watermark and `impact_reports` store into the
live Nest API and Go worker. Complements [PHASE0_WIRING.md](./PHASE0_WIRING.md)
and [DECISIONS.md](./DECISIONS.md).

## What Phase 1 wired

| Seam | Status |
|---|---|
| `subscriptions.last_event_sha` | **Done.** HOT writes via `PostgresWatermarkStore.setLastEventSha`. Never touches `last_scanned_sha`. |
| `subscriptions.indexed_at` | **Done.** Set when COLD/WARM advances `last_scanned_sha` (worker `UpdateSubscriptionScanWatermark`; also `setIndexedSha` seam). |
| Dual watermark alias | **Documented in schema.** `indexed_sha` := `last_scanned_sha` (authoritative, worker-owned). Do **not** rename `last_scanned_sha`. |
| `impact_reports` table | **Done.** Structured HOT report columns + full `report` JSONB for round-trip. |
| `PostgresWatermarkStore` / `PostgresImpactReportStore` | **Live** in API (`phase0-stores.ts` wraps platform adapters). |
| Staleness vs live DB | **Done.** HOT engine reads real `indexed_sha` + `indexed_at` + `last_event_sha`; scenario 8 (`graph_behind_event` → UNKNOWN + async WARM) works against store-backed watermarks. |
| Read API (deep-link target) | **Done.** `GET /impact/reports/:id` prefers `impact_reports`; `GET /impact/reports?repo_id=` lists recent HOT reports. Legacy `change_plans` still fallback. |
| Audit breadcrumb | Kept: HOT save still inserts a summary row into `audit_log`, but the report itself lives in `impact_reports`. |

### Dual watermark — who writes what

```
COLD / WARM (Go worker)
  → last_scanned_sha  (= indexed_sha)
  → indexed_at = now()
  → never writes last_event_sha

HOT (Nest API ImpactLoop / ImpactEngine)
  → last_event_sha only (informational)
  → impact_reports row
  → NEVER last_scanned_sha / indexed_at
  → NEVER Neo4j graph write
```

## Phase 0 items resolved by Phase 1

| Phase 0 stub | Resolution |
|---|---|
| `Phase0WatermarkStore.setLastEventSha` no-op | Real Postgres UPDATE of `last_event_sha` |
| HOT reports → `audit_log` only | Reports persist to `impact_reports`; audit_log kept as breadcrumb |

## What remains stubbed / deferred

| Item | Gap | Next phase |
|---|---|---|
| Pattern stamps | `EmptyPatternStore` — no disturb notifications from live DB | Phase 4 |
| Notifier / GitHub check + comment | `LogNotifier` only | Phase 3 |
| Narrator | `TemplateNarrator` only (no AI service) | **Resolved in Phase 2** — see [PHASE2_WIRING.md](./PHASE2_WIRING.md) |
| PR file list fetch | Webhook payloads often omit file paths; HOT may be silent until GitHub API fetch | **Resolved in Phase 2** — see [PHASE2_WIRING.md](./PHASE2_WIRING.md) |
| Docker API image | **Done.** See [DOCKER_BUILD.md](./DOCKER_BUILD.md). | — |

## Tests

```bash
# Platform reference suite (includes Phase 1 postgres adapter tests)
cd platform && npm test

# API Phase 0 + Phase 1 wiring contracts (no live DB)
cd apps/api && npm run test:phase1

# API typecheck/build
cd apps/api && npm run build

# Worker (Docker — Go not assumed locally), after watermark change:
docker run --rm -v "<repo>/apps/worker:/app" -w /app golang:1.22 go test ./internal/store/ ./internal/pipeline/ -count=1
```

## Phase 2 next steps

**Phase 2 is done** — see [PHASE2_WIRING.md](./PHASE2_WIRING.md).

Historical checklist (completed):

1. Fetch PR changed files (and contents) when the webhook payload lacks them.
2. Wire evidence-only AI narrator with `TemplateNarrator` fallback.
3. ~~Fix Docker build context so `@infragraph/platform` is available in the API image.~~ **Done** — [DOCKER_BUILD.md](./DOCKER_BUILD.md).

Remaining follow-ups moved to Phase 3+ (GitHub check/comment, notifier, patterns).
