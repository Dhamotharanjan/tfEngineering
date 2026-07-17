# InfraGraph Stakeholder Prototype

Professional web UI for **CTO, technical architect, and platform team** buy-in demos.

## Quick start (Docker — recommended)

From repository root:

```powershell
docker compose -f docker-compose.prototype.yml up --build
```

Open **http://localhost:3000**

## Local dev (without Docker)

```powershell
cd apps/web
npm install
npm run dev
```

## Screens included

| Screen | Route | Purpose |
|--------|-------|---------|
| Dashboard | `/` | Executive overview |
| Blast Radius | `/impact/modules-vpc` | Dependency graph |
| Change Plan | `/plans/change` | Phased rollout |
| Rollout Plan | `/plans/rollout` | Canary strategy per downstream |
| Release Tag Impact | `/releases/v3.0.0` | Mandatory tag-merge analysis |
| RDS Lifecycle | `/lifecycle/rds` | Build / rebuild / restore / decommission |
| FinOps | `/finops` | Cost attribution |
| Observability | `/observability` | Patch cycles, security, DR tests |
| EOL | `/eol` | Extended support tax |
| Repo Subscriptions | `/repos` | Opt-in repos |
| CAB Reports | `/reports` | Export preview |
| Audit Log | `/audit` | Compliance trail |
| Scan Activity | `/activity` | Job queue status |
| Admin | `/admin` | Integrations |

## Production path

This prototype uses **mock data** in `src/data/mockData.js`. The production app will:

- Replace mocks with **Neo4j** (graph) and **PostgreSQL** (plans, subscriptions, audit)
- Connect **GitHub/GHE webhooks** for release tag mandatory analysis
- Load **registry/** and **config/** JSON at runtime

Component structure and routes are designed to carry forward into the real implementation.
