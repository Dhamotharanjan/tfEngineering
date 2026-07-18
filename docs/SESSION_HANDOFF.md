# Session handoff — TF Engineering (resume tomorrow)

**Last check-in:** Saturday 2026-07-18 (EOD closeout).  
Stack: Nest API + Vite/React web + Go worker + FastAPI AI + Postgres/Neo4j/Redis/MinIO/**Milvus** (docker-compose).

## What landed today (2026-07-18)

- **Scanner Monitor** — `/scanner` (schedules, jobs, stage logs); failure UI shows **error + timestamps**; `/activity` redirects here. Adhoc scans from Subscriptions → P1 `full_scan` with `payload.trigger=adhoc_ui` (subscribed only).
- **Remote-first subscription scanning** — subscribe = remote rights on `github_full_name`; ephemeral mirrors under `data/mirrors/<id>`; **no product-owned repo copies**. `local_path` only with `IGCS_FORCE_LOCAL=true` / offline demo. Public clone default; private needs `GITHUB_TOKEN` / `GH_TOKEN`.
- **Release notes on impact reports** — webhook `release.body` (+ name/tag) on `impact_report`; GitHub Releases API fill-in when body empty; shown on Release Tag + AI chat context.
- **Subscribe-from-UI** — **Add repo** modal on `/repos` (white modal panel); creates/updates subscription + can queue scan.
- **Resource persist fix** — file-scoped resource IDs so duplicate `type.name` across files/modules don’t collide (e.g. public VPC / EKS examples).
- **Successful remote full scans** of public repos (e.g. **binbash live** `binbashar/le-tf-infra-aws`, **terraform-aws-eks** `terraform-aws-modules/terraform-aws-eks`).
- **Strong-additions onboarding** — user was adding further repos via the UI Subscribe / Add repo flow (continue from `/repos` tomorrow if incomplete).

## Docker (EOD 2026-07-18)

All compose services **Up**: `api` (:8000), `web` (:3000), `worker`, `ai` (:8100), `postgres`, `neo4j`, `redis`, `minio`, `milvus` (:19530), `attu` (:3001), plus `prototype-web` (:4000). No restart needed for handoff.

## Uncommitted work (do NOT commit unless asked)

Large WIP across API / web / worker / schema / AI — **not committed** (last commit still `f416919 Successfull Day -1`). Notable areas:

| Area | Paths (indicative) |
|------|-------------------|
| Scanner / scheduler / impact API | `apps/api/src/scanner/`, `scheduler/`, `impact/`, queue + webhooks + subscriptions |
| Web UI | `ScannerMonitor.jsx`, `Repos.jsx` (Add repo), `ArchitectureDiagram.jsx`, `Pitch.jsx`, client/sidebar |
| Worker remote + delta + impact | `acquisition/git.go`, `stages/delta/`, `impact/release_notes.go`, `contracts.go`, parse/store fixes |
| Schema / config | `config/postgres/schema.sql`, `config/repo-subscriptions.json` |
| Docs / AI | `docs/architecture/change-scanner*.md`, `services/ai/infra_interactions.py` |

Ignore `data/` artifacts / mirrors (gitignored). Do not commit secrets or volumes.

---

## Remote-first subscriptions (implemented)

- **Model**: subscribe = remote scan rights on `github_full_name` — **no product-owned repo copies**.
- **Acquire**: remote clone/fetch first → ephemeral `data/mirrors/<id>` cache; `local_path` only with `IGCS_FORCE_LOCAL=true` or offline demo.
- **Public clone**: allowed by default; private needs `GITHUB_TOKEN` / `GH_TOKEN` (`GITHUB_HOST` for GHE).
- **Release notes**: webhook `release.body` (+ name/tag) stored on `impact_report`; GitHub Releases API fill-in when body empty; shown on Release Tag + AI chat context.

## Scanner Monitor + release-tag impact (implemented)

- **UI**: `/scanner` Scanner Monitor (schedules + jobs + stage logs + failure reason/time); `/activity` redirects here.
- **API**: `GET /api/scanner/overview|jobs|jobs/:id/runs`, `POST /api/scanner/reconcile`; `GET/POST /api/impact/reports…` + chat.
- **Adhoc**: Subscriptions **Adhoc scan** → `full_scan` P1 `payload.trigger=adhoc_ui` (subscribed only; Postgres gate).
- **Reconcile**: subscribed + `reconcile_enabled` (default true).
- **Impact engine**: contract diffs from `config/release-contracts/seed.json`, breaking flags, downstream file/dir from `module_references`, persisted on `change_plans.impact_report` / `rollout_plans.locations`.
- **Tree**: `/dependencies?impact=:changePlanId` highlights breaking nodes + AI chat panel.

## IGCS — Git change scanning (implemented)

Design: [`docs/architecture/change-scanner.md`](architecture/change-scanner.md)

- **Webhook**: `POST /api/webhooks/github` — HMAC (`GITHUB_WEBHOOK_SECRET`), delivery dedupe, `github_full_name` → subscription id, push coalesce, PR path scan.
- **Jobs**: `incremental_scan` (git diff + dependent closure), `full_scan`, `reconcile_scan`, `mandatory_impact_analysis`, `module_impact_hint`.
- **Acquisition**: **remote-first** git mirror; SHA watermark on `subscriptions.last_scanned_sha`.
- **Scheduler**: `POST /api/scheduler/reconcile` + nightly cron from `scan-profiles.json` (`IGCS_SCHEDULER=false` to disable).
- **Differentiator**: module interface file changes → `module_impact_hint` + pattern interaction sync.

## Two-layer Infra Graph

- **UI**: `apps/web/src/pages/InfraGraph.jsx` — tabs **Patterns (Layer 1)** and **By Application (Layer 2)**.
- **Route**: `http://localhost:3000/graph/infra` (`?tab=patterns|application`, `family`, `patternId`).
- **Layer 1 — patterns + stamp + architecture**
  - Catalog / families / pattern graph: API `apps/api/src/graph/pattern.service.ts`, `pattern-classifier.ts` (includes **pros/cons** per pattern: architect + FinOps + risk).
  - Architecture payload (live Neo4j/Postgres + seed fill + **swimlanes**): `apps/api/src/graph/pattern-architecture.ts`.
  - **Professional diagram** (not force graph): `apps/web/src/components/ArchitectureDiagram.jsx` — layered lanes Internet → Edge → VPC → Subnets/AZs → SG → Data plane; ingress/egress tables retained.
  - `DependencyGraph` remains for Layer 2 / catalog overview only.
  - Stamp form on Layer 1 writes pattern metadata via `graph.controller.ts`.
  - **Milvus interaction pipeline** (accuracy-first):
    - Extract: `apps/api/src/graph/pattern-interactions.ts` (IN_VPC, USES_SG, ALLOWS_CIDR, ports/protocols, HA facts).
    - AI: `services/ai/infra_interactions.py` + endpoints on `main.py` → collections `infra_interactions` / `infra_patterns`.
    - Hybrid derive: rules (family/HA/ports) preferred over vectors.
    - Sync: `POST /api/graph/patterns/interactions/sync`, status `GET /api/graph/patterns/milvus/status`.
    - Architecture GET also fire-and-forgets interaction upsert + derive.
- **Layer 2**: application-scoped dependency graph (`DependencyGraph.jsx` + graph service Neo4j queries).
- Org graph route redirects: `/graph/org` → `/graph/infra?tab=patterns`.

## Release Compare + AI Raise PR

- **UI**: `apps/web/src/pages/ReleaseCompare.jsx` — module/release compare, AI recommendations, chat, approvers, Raise PR / bulk.
- **API**: `apps/api/src/release-compare/` — compare, `raise-pr`, `raise-pr/bulk`, `pr-requests` approve/reject/proceed/chat, `approvers`.
- **AI**: `services/ai/main.py` + `release_analyze.py`
  - `POST /release-compare/analyze` — upgrade paths, snapshot/AMI-style prereqs, impact notes (doc-aware when AWS docs reachable).
  - `POST /release-compare/chat` — scoped engineer chat for Raise PR workbench.
- **PR mode today**: scaffold / recorded requests; `GITHUB_TOKEN`/`GH_TOKEN` detected but **Octokit real PR open not implemented**.

## Subscriptions / blast radius

- Config: `config/repo-subscriptions.json`, `config/scan-profiles.json`, schemas under `config/schema/`.
- API: `subscriptions.controller.ts`, `blast-radius.controller.ts`.
- UI: `/impact/:moduleId` (`BlastRadius.jsx`), module slug map `apps/web/src/config/blastRadiusModules.js`.
- Worker pipeline: parse → enrich → graph write → impact (`apps/worker/internal/...`).
- Sample/MVP TF under `mvp_demo/sample_repos/`; release contracts seed `config/release-contracts/seed.json`.

## Key localhost:3000 routes

| Path | Page |
|------|------|
| `/` | Dashboard |
| `/repos` | Subscriptions · **Add repo** · Adhoc scan |
| `/scanner` | Scanner Monitor |
| `/impact/:moduleId` | Blast radius |
| `/dependencies` | Dependency hierarchy |
| `/graph/infra` | Infra Graph (2 layers) |
| `/release-compare` | Release compare / Raise PR |
| `/plans/change`, `/plans/rollout` | Plans |
| `/releases/:tagId` | Release tag (+ release notes) |
| `/lifecycle/rds`, `/lifecycle/rds/wizard` | RDS lifecycle |
| `/admin`, `/audit`, `/reports`, `/finops`, `/observability`, `/eol` | Supporting |

API typically via compose (Nest :8000); AI FastAPI (:8100); worker Go; **Milvus :19530**.

## Resume tomorrow (practical)

1. Confirm stack: `docker compose ps` — expect api/web/worker/ai + data stores Up; open `http://localhost:3000`.
2. Finish any **strong-additions** repo onboarding on `/repos` (Add repo → subscribe → Adhoc scan); watch `/scanner` for failures.
3. Spot-check remote scans still green for binbash / terraform-aws-eks (or re-adhoc if graph empty after reboot).
4. If Milvus empty after restart: `POST http://localhost:8000/api/graph/patterns/interactions/sync`.
5. **Primary next build:** AI AWS Chat Bot (`ai-aws-chatbot`) + live AWS Describe* (`aws-live-instance-status`) — plan under `.cursor/plans` (do not edit plans in this closeout).
6. Optional harden: Octokit real PR open; worker → AI interaction ingest on scan complete; Neo4j creds via env.

## NOT done (parked)

- Real GitHub PR creation via Octokit (token path stubbed).
- Multi-version release contracts beyond seed/demo.
- Production auth, webhook hardening, Neo4j default password cleanup.

## Quick verify checklist

1. `docker compose up` if anything is down (`docker-compose.yml`; prototype `docker-compose.prototype.yml` on :4000).
2. `/repos` → Add repo / Adhoc; `/scanner` for job + error/time.
3. Layer 1: `/graph/infra?tab=patterns` → multi-AZ vs single-AZ stamp diagram.
4. Read this file + `docs/PARSER_ACCEPTANCE_TEST.md` if touching the parser.

## Do not commit locally

`data/`, `.env`, `node_modules/`, `dist/`, MinIO/Postgres volumes — gitignored.
