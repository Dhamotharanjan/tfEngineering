# InfraGraph `platform/` — the Impact Loop reference implementation

Greenfield, self-contained implementation of the **impact loop** doctrine:
**three paths, one engine.** It lives entirely in `platform/` and does not modify
or depend on `apps/`, `services/`, or `config/`. It reads those to align naming,
data shapes, and job vocabulary, but ships as an additive, independently testable
module.

```
COLD  subscribe / full scan / reconcile   -> parse -> WRITE Postgres + Neo4j -> set indexed_sha
WARM  push to default branch               -> incremental parse -> WRITE graph -> advance indexed_sha
HOT   pull_request / tag-release / pre-apply -> READ ONLY. Never writes the graph. Never advances indexed_sha.
```

---

## Language choice: TypeScript (Node, ESM)

TypeScript was chosen deliberately:

- The API (`apps/api`) is **NestJS/TypeScript**, and the impact loop is an
  **I/O-orchestration** layer (webhook routing, port fan-out, policy, notify).
  It slots into the existing API process with zero language impedance and can
  share the same `pg`/`ioredis`/`neo4j-driver` clients behind the port seams.
- The contract-diff and classification logic mirrors
  `apps/api/src/release-compare/release-compare.service.ts` almost 1:1, so
  keeping it in TS preserves reviewability against the code it will eventually
  replace.
- Go is defensible for the write side (it aligns with the worker), but the write
  side here is a thin, guarded seam — the authoritative parser/graph-writer stays
  in the Go worker. This module owns **routing + the read-only HOT engine**.

**Runtime & toolchain:** Node ≥ 22.6 with native TypeScript type-stripping. The
only dependencies are `typescript` + `@types/node` (dev only). Tests use the
built-in `node:test` runner — no Jest/Vitest, no build step.

```bash
cd platform
npm install
npm test          # runs node --test over src/**/*.test.ts
npm run typecheck  # tsc --noEmit
npm run test:typed # typecheck + test
```

---

## No-hardcoded-repo-data policy (hard requirement)

**There are zero hardcoded repository names, org names, GitHub full names, module
names, version strings, branch names, CIDRs, ports, or account IDs anywhere in
runtime code (`src/**`, excluding `src/**/__tests__`).**

Every such value comes from exactly one of:

1. **Subscription records** — read at runtime via the `SubscriptionReader` port.
2. **Config / env** — `src/config` with documented env vars and safe defaults
   (empty lists, `.tf/.hcl` extensions, empty base URL).
3. **UI / API input** — e.g. which repo to subscribe, which versions to compare,
   thresholds, policy dials, notification routing.

Demo/placeholder values exist **only** under `platform/examples/` and
`platform/src/**/__tests__/` and are never imported by runtime code. A guard test
(`contracts-config-narration.test.ts`) asserts config defaults carry no customer
data, and the fingerprint test asserts we use a real SHA-256 content hash — **not
fake hash "embeddings."**

### Fixed vs legacy

| Legacy behavior (in `apps/`) | This implementation |
|---|---|
| `webhooks.controller.ts` maps `pull_request` → `incremental_scan` (a graph-writing scan). | **Fixed.** `pull_request` is structurally HOT (`pr_impact_query`); the HOT engine receives **no `GraphWriter`**, so it *cannot* write the graph. Guard test enforces zero graph writes / no `indexed_sha` advance. |
| Hardcoded fallback versions `from_version \|\| 'v2.4.2'`, `to_version \|\| 'v3.0.0'`, `tag \|\| ...`. | **Fixed.** Versions resolve from the pin delta (PR), the release tag (tag event), or UI-supplied overrides. No fallback literals; missing versions → `UNKNOWN`, never a guessed default. |
| Frontend/demo repo-name resolution and `acme/` prefix stripping. | **Fixed.** Repo identity is resolved only via `SubscriptionReader.resolveByFullName`. Unknown/unsubscribed repos are skipped. |
| Impact analysis writes change/rollout plans as part of a tag flow. | HOT writes **only** impact reports (`ImpactReportStore`) + informational `last_event_sha`. |

---

## Folder map

```
platform/
├─ README.md
├─ package.json            # scripts: test, typecheck, test:typed
├─ tsconfig.json           # strict, erasableSyntaxOnly, NodeNext
├─ .env.example            # documented env vars, safe defaults
├─ examples/               # OBVIOUSLY-FAKE placeholders only (never imported at runtime)
│  ├─ config.example.json
│  ├─ subscriptions.example.json
│  └─ contracts.example.json
└─ src/
   ├─ index.ts             # public barrel
   ├─ domain/              # pure types, no I/O
   │  ├─ paths.ts          # ExecutionPath COLD|WARM|HOT + pathMayWriteGraph
   │  ├─ jobs.ts           # JobIntent cold_scan|warm_incremental|pr_impact_query|tag_impact_query
   │  ├─ events.ts         # NormalizedVcsEvent + FileChange
   │  ├─ classification.ts # ImpactClass, PatternVerdict, CheckVerdict
   │  ├─ contract.ts       # ModuleContract, ContractVar/Output, ContractDiff
   │  ├─ watermark.ts      # dual watermark (indexedSha vs lastEventSha)
   │  ├─ subscription.ts   # Subscription record
   │  ├─ pattern.ts        # InfraPattern + PatternStamp
   │  ├─ impact.ts         # ImpactReport, evidence, consumer, override
   │  └─ parsed.ts         # minimal ParsedRepo for the write side
   ├─ ports/index.ts       # GraphReader/Writer, Subscription/Watermark/Contract/Pattern/Report stores, JobEnqueuer, AuditStore, Notifier
   ├─ integration/         # routing layer (provider-agnostic)
   │  ├─ provider.ts       # VcsProviderAdapter port + RawWebhook
   │  ├─ router.ts         # routeEvent / coldScanIntent / ProviderRegistry
   │  └─ adapters/
   │     ├─ github.ts      # GitHub adapter (verify + normalize)
   │     └─ stubs.ts       # GitLab / Azure DevOps / Bitbucket seams (throw NotImplemented)
   ├─ contracts/
   │  ├─ fingerprint.ts    # deterministic SHA-256 interface fingerprint (no embeddings)
   │  └─ diff.ts           # typed change records
   ├─ impact/              # HOT engine (read-only)
   │  ├─ delta.ts          # pin/source/version delta extraction + IaC relevance
   │  ├─ classifier.ts     # deterministic BREAKING|NON_BREAKING|UNKNOWN
   │  ├─ staleness.ts      # staleness detection
   │  ├─ source-resolver.ts# module source string -> module repo id (subscription-driven)
   │  └─ engine.ts         # orchestrates the HOT query; NO GraphWriter here
   ├─ pattern/guard.ts     # COMPATIBLE|DISTURBED|UNKNOWN
   ├─ decision/
   │  ├─ policy.ts         # policy dials + conservative defaults
   │  └─ verdict.ts        # PASS|WARN|BLOCK
   ├─ notify/router.ts     # recipient resolution from subscription metadata / roles
   ├─ narration/
   │  ├─ port.ts           # Narrator interface + evidence-only prompt contract
   │  └─ template.ts       # deterministic, LLM-free fallback narrator
   ├─ config/
   │  ├─ schema.ts         # config shape + validation
   │  └─ loader.ts         # env + file loader with defaults
   ├─ app/
   │  ├─ impact-loop.ts    # facade: route -> HOT inline | COLD/WARM enqueue
   │  ├─ scan.ts           # ScanRunner: the ONLY graph-write + indexed_sha path
   │  ├─ override.ts       # audited override of a failing check
   │  └─ deep-link.ts      # deep-link payload generation
   └─ adapters/
      ├─ memory/index.ts   # in-memory implementations of every port (tests + local)
      ├─ postgres/index.ts # Postgres seam (injected SqlExecutor; aligns to schema.sql)
      └─ neo4j/index.ts    # Neo4j seam (injected CypherRunner; aligns to writer.go)
```

### Layering

`domain` (pure) → `ports` (interfaces) → feature modules (`integration`,
`contracts`, `impact`, `pattern`, `decision`, `notify`, `narration`) →
`app` (facade/wiring) → `adapters` (memory + real-store seams). Nothing in a
lower layer imports an adapter; the engine depends only on ports, so Neo4j and
Postgres are swappable and every path is testable offline.

---

## How config / UI inputs replace hardcoded values

- **Which repo / versions:** resolved from the webhook (pin delta, release tag)
  and the `SubscriptionReader`. Manual triggers pass `fromVersion`/`toVersion`
  through the UI into `HotQueryInput`.
- **IaC relevance:** `PLATFORM_IAC_EXTENSIONS` (default `.tf,.hcl`).
- **Policy dials:** `PLATFORM_BLOCK_ON_BREAKING`, `PLATFORM_BLOCK_ON_DISTURBED`,
  `PLATFORM_FAIL_CLOSED_ON_UNKNOWN` (default: block on breaking/disturbed, warn
  on unknown — we never guess a class, we warn + refresh).
- **Notification routing:** `PLATFORM_ARCHITECT_RECIPIENTS`,
  `PLATFORM_OWNER_CONTACT_KEYS`; consumer owners come from each subscription's
  `contacts`. No handles are hardcoded.
- **Deep links:** `PLATFORM_DEEP_LINK_BASE_URL` (default empty → relative links).

See `.env.example` and `examples/config.example.json`.

---

## Determinism & AI grounding

- Classification is **100% deterministic** from evidence (contract diff + the
  consumer's actually-provided inputs + file/line). See `impact/classifier.ts`.
- Missing contracts or a stale graph → **`UNKNOWN`** and an async **WARM** refresh
  is enqueued (`warm_incremental`). The engine **never rebuilds inline** and
  **never writes the graph** (it holds no `GraphWriter`).
- AI is **narration only**. `narration/port.ts` defines the interface and the
  evidence-only prompt contract (`NARRATION_SYSTEM_PROMPT` +
  `buildNarrationUserPayload`, which exposes *only* evidence fields). The class
  is passed in and must be echoed unchanged. `TemplateNarrator` is the
  deterministic fallback so the system works with **no LLM configured**.

---

## Scenario matrix → tests

Run `npm test`; all 32 tests pass. The 11 required scenarios plus the HOT
write-guard are covered as follows:

| # | Scenario | Test file · test name |
|---|---|---|
| 1 | Cold subscribe (write graph, set `indexed_sha`) | `cold-warm-guard.test.ts` · *scenario 1: COLD subscribe writes graph and sets indexed_sha* |
| 2 | Warm push (incremental write, advance `indexed_sha`) | `cold-warm-guard.test.ts` · *scenario 2: WARM push writes graph incrementally...* |
| 3 | PR with no IaC change → silence | `hot-impact.test.ts` · *scenario 3: PR changing no IaC files is silent* |
| 4 | Non-breaking pin bump | `hot-impact.test.ts` · *scenario 4: non-breaking pin bump classifies NON_BREAKING* |
| 5 | Breaking (removed input in use + new required not set) | `hot-impact.test.ts` · *scenario 5: breaking pin bump classifies BREAKING with evidence* |
| 6 | Pattern disturbed → architect notified | `pattern.test.ts` · *scenario 6: disturbed stamped pattern notifies the architect* |
| 7 | Tag fan-out | `hot-impact.test.ts` · *scenario 7: tag release fans out to consumers* |
| 8 | Stale graph → UNKNOWN + async WARM enqueued + NO graph write | `hot-impact.test.ts` · *scenario 8: stale graph yields UNKNOWN, enqueues WARM, writes no graph* |
| 9 | Audited override | `override-deeplink.test.ts` · *scenario 9: override of a BLOCK verdict is audited* |
| 10 | Deep-link payload generation | `override-deeplink.test.ts` · *scenario 10: deep links are generated from config base URL* |
| 11 | **Guard:** HOT paths perform zero graph writes / never advance `indexed_sha` | `cold-warm-guard.test.ts` · *guard: HOT paths never write the graph and never advance indexed_sha* |

Supporting tests: routing/adapters (`routing.test.ts`, `loop.test.ts`),
contract fingerprint/diff, config validation & defaults, and narration grounding
(`contracts-config-narration.test.ts`), plus a `missing contract → UNKNOWN` case.

---

## Wiring seams (where this plugs into the existing system — not yet wired)

1. **Webhook entry (`apps/api/src/webhooks/webhooks.controller.ts`):** replace the
   inline event handling with `ImpactLoop.handleWebhook(new GitHubAdapter(), raw, secret)`.
   This removes the `pull_request → incremental_scan` bug: PRs become HOT.
2. **Queue (`apps/api/src/queue/queue.service.ts`):** implement `JobEnqueuer` over
   `QueueService` (map `cold_scan`/`warm_incremental` to `full_scan`/`incremental_scan`
   on the existing Redis queues; HOT queries run inline in the API).
3. **Worker (`apps/worker/internal/pipeline/runner.go`):** the worker keeps owning
   COLD/WARM parse + graph write. `ScanRunner`/`Neo4jGraphWriter` here document the
   equivalent Node seam and the single place `indexed_sha` advances.
4. **Postgres (`config/postgres/schema.sql`):** `PostgresSubscriptionReader`,
   `PostgresWatermarkStore` (reuses `subscriptions.last_scanned_sha` as
   `indexed_sha`; add a `last_event_sha` column), `PostgresContractStore`
   (`module_release_contracts`), `PostgresAuditStore` (`audit_log`). Add a new
   `impact_reports` table for `PostgresImpactReportStore`.
5. **Neo4j (`apps/worker/internal/stages/graph/writer.go`):** `Neo4jGraphReader`
   fan-out matches `REFERENCES_MODULE`/`USES_MODULE` edges written by the worker.
6. **AI service (`services/ai`):** implement `Narrator` against
   `/release-compare/analyze`, honoring `NARRATION_SYSTEM_PROMPT`; fall back to
   `TemplateNarrator` when unreachable.
7. **Notifications:** implement `Notifier` over the existing notification channel;
   recipients already resolved from subscription `contacts` + config roles.
```
