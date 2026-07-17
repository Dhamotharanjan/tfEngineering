# Session handoff — TF Engineering (resume tomorrow)

Last check-in: 2026-07-17. Stack: Nest API + Vite/React web + Go worker + FastAPI AI + Postgres/Neo4j/Redis/MinIO (docker-compose).

## Two-layer Infra Graph

- **UI**: `apps/web/src/pages/InfraGraph.jsx` — tabs **Patterns (Layer 1)** and **By Application (Layer 2)**.
- **Route**: `http://localhost:3000/graph/infra` (`?tab=patterns|application`, `family`, `patternId`).
- **Layer 1 — patterns + stamp + architecture**
  - Catalog / families / pattern graph: API `apps/api/src/graph/pattern.service.ts`, `pattern-classifier.ts`.
  - Architecture payload (live Neo4j/Postgres + seed fill): `apps/api/src/graph/pattern-architecture.ts`.
  - Stamp form on Layer 1 writes pattern metadata (ownership/classification) via graph/pattern endpoints in `graph.controller.ts`.
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
| `/impact/:moduleId` | Blast radius |
| `/dependencies` | Dependency hierarchy |
| `/graph/infra` | Infra Graph (2 layers) |
| `/release-compare` | Release compare / Raise PR |
| `/plans/change`, `/plans/rollout` | Plans |
| `/releases/:tagId` | Release tag |
| `/lifecycle/rds`, `/lifecycle/rds/wizard` | RDS lifecycle |
| `/repos`, `/admin`, `/activity`, `/audit`, `/reports`, `/finops`, `/observability`, `/eol` | Supporting |

API typically via compose (Nest); AI service FastAPI; worker Go.

## NOT done (next session)

- Real GitHub PR creation via Octokit (token path is stubbed).
- Multi-version release contracts beyond seed/demo data.
- Harden Neo4j defaults (local `neo4j123` in compose/code — use env in real deploys).
- Production auth, webhook hardening, full public-repo clone fixtures (scripts exist; `mvp_demo/public_repos/` is placeholder).
- Some UI pages still mock/CTO-demo oriented.

## Resume checklist

1. `docker compose up` (see `docker-compose.yml`; prototype variant `docker-compose.prototype.yml`).
2. Rescan sample repos / Admin clear+scan if graph empty.
3. Verify Layer 1 architecture for a pattern, then Raise PR flow on Release Compare.
4. Read this file + `docs/PARSER_ACCEPTANCE_TEST.md` if touching the parser.

## Do not commit locally

`data/`, `.env`, `node_modules/`, `dist/`, MinIO/Postgres volumes — gitignored.