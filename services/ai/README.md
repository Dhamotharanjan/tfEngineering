# AI Reasoning Service

Python FastAPI service for Stage 6 async intelligence (embeddings + pattern detection).

## Endpoints

- `GET /health` — service health
- `POST /embed/chunk` — embed and upsert IaC chunk to Milvus `iac_patterns`
- `POST /ingest/parse-result` — batch embed stack profiles and resource patterns from parse results
- `POST /patterns/detect` — async fleet pattern detection (cost waste, etc.)
- `GET /patterns/similar?repo_id=` — vector similarity lookup

## Run locally

```bash
cd services/ai
pip install -r requirements.txt
MILVUS_URI=http://localhost:19530 uvicorn main:app --port 8100
```

## Docker

Included in root `docker-compose.yml` as service `ai` on port 8100.
