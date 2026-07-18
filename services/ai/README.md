# AI Reasoning Service

Python FastAPI service for Stage 6 async intelligence (embeddings + Layer-1 pattern vectors).

## Endpoints

- `GET /health` — service health + Milvus infra collection stats
- `POST /embed/chunk` — embed and upsert IaC chunk to Milvus `iac_patterns`
- `POST /ingest/parse-result` — batch embed stack profiles / resources; optional `interactions[]` → `infra_interactions`
- `POST /patterns/detect` — async fleet pattern detection (cost waste, etc.)
- `GET /patterns/similar?repo_id=` — vector similarity lookup
- `GET /infra/milvus/status` — `infra_interactions` + `infra_patterns` entity counts
- `POST /infra/interactions/ingest` — upsert exhaustive interaction signatures (edges, ports, CIDRs, HA facts)
- `POST /infra/patterns/seed` — seed canonical Layer-1 pattern template vectors
- `POST /infra/patterns/derive` — hybrid derive (rules for family/HA/ports first, vectors for similarity)
- `POST /release-compare/analyze` — Raise PR upgrade analysis
- `POST /release-compare/chat` — Raise PR scoped chat

## Collections

| Collection | Purpose |
|---|---|
| `iac_patterns` | Legacy IaC chunk embeddings |
| `infra_interactions` | Exhaustive component interaction signatures (accuracy-first) |
| `infra_patterns` | Canonical pattern template vectors for hybrid match |

## Run locally

```bash
cd services/ai
pip install -r requirements.txt
MILVUS_URI=http://localhost:19530 uvicorn main:app --port 8100
```

## Docker

Included in root `docker-compose.yml` as service `ai` on port 8100.
