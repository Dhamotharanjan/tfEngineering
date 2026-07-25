import hashlib
import json
import os
from typing import Any

import httpx
import numpy as np
from fastapi import FastAPI, BackgroundTasks
from pymilvus import Collection, CollectionSchema, DataType, FieldSchema, connections, utility

from release_analyze import analyze_release_change, chat_release_compare
from impact_narrate import narrate_impact
from infra_interactions import (
    collection_stats,
    derive_pattern,
    ensure_interactions_collection,
    ingest_interactions,
    reset_infra_collections,
    seed_canonical_patterns,
)

app = FastAPI(title="InfraGraph AI Service", version="1.0.0")

MILVUS_URI = os.environ.get("MILVUS_URI", "http://localhost:19530")
POSTGRES_DSN = os.environ.get("POSTGRES_DSN", "postgresql://tfengineering:tfengineering123@localhost:5432/tfengineering")
COLLECTION = "iac_patterns"
DIM = int(os.environ.get("EMBEDDING_DIM", "64"))


def connect_milvus():
    host = MILVUS_URI.replace("http://", "").replace("https://", "").split(":")[0]
    port = MILVUS_URI.split(":")[-1] if ":" in MILVUS_URI else "19530"
    connections.connect(alias="default", host=host, port=port)


def ensure_collection():
    connect_milvus()
    if utility.has_collection(COLLECTION):
        return Collection(COLLECTION)
    fields = [
        FieldSchema(name="id", dtype=DataType.VARCHAR, is_primary=True, max_length=64),
        FieldSchema(name="repo_id", dtype=DataType.VARCHAR, max_length=128),
        FieldSchema(name="chunk_type", dtype=DataType.VARCHAR, max_length=64),
        FieldSchema(name="embedding", dtype=DataType.FLOAT_VECTOR, dim=DIM),
    ]
    schema = CollectionSchema(fields, description="IaC pattern embeddings")
    col = Collection(COLLECTION, schema)
    col.create_index("embedding", {"index_type": "IVF_FLAT", "metric_type": "L2", "params": {"nlist": 128}})
    return col


def embed_text(text: str) -> list[float]:
    """Deterministic local embedding (no external API) — replace with Ollama/BYOK in production."""
    h = hashlib.sha256(text.encode()).digest()
    arr = np.frombuffer(h, dtype=np.uint8).astype(np.float32)
    reps = int(np.ceil(DIM / len(arr)))
    vec = np.tile(arr, reps)[:DIM]
    vec = vec / (np.linalg.norm(vec) + 1e-9)
    return vec.tolist()


@app.get("/health")
def health():
    milvus_ok = False
    infra_stats = {}
    try:
        connect_milvus()
        milvus_ok = True
        infra_stats = collection_stats().get("collections", {})
    except Exception as exc:
        infra_stats = {"error": str(exc)}
    return {
        "status": "ok",
        "service": "ai",
        "collection": COLLECTION,
        "milvus": "ok" if milvus_ok else "unavailable",
        "infra_collections": infra_stats,
    }


@app.post("/admin/reset")
def admin_reset():
    connect_milvus()
    if utility.has_collection(COLLECTION):
        utility.drop_collection(COLLECTION)
    ensure_collection()
    infra = reset_infra_collections()
    return {"status": "cleared", "collection": COLLECTION, "infra": infra}


@app.post("/embed/chunk")
def embed_chunk(body: dict[str, Any]):
    repo_id = body.get("repo_id", "unknown")
    chunk_type = body.get("chunk_type", "stack_profile")
    content = body.get("content", "")
    chunk_id = body.get("id") or hashlib.md5(f"{repo_id}:{content[:200]}".encode()).hexdigest()
    vector = embed_text(content)
    try:
        col = ensure_collection()
        col.load()
        col.insert([[chunk_id], [repo_id], [chunk_type], [vector]])
        col.flush()
    except Exception as exc:
        return {"id": chunk_id, "status": "embedding_computed", "milvus": "unavailable", "error": str(exc)}
    return {"id": chunk_id, "status": "upserted", "dim": DIM}


@app.post("/patterns/detect")
def detect_patterns(background_tasks: BackgroundTasks, body: dict[str, Any] | None = None):
    background_tasks.add_task(run_pattern_detection)
    return {"status": "pattern_detection_started"}


def run_pattern_detection():
    import psycopg2

    try:
        conn = psycopg2.connect(POSTGRES_DSN)
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO pattern_alerts (pattern_type, severity, title, description, affected_repos)
            SELECT 'cost_waste', 'medium', 'Oversized RDS instance class detected',
                   'Multiple stacks use db.m5.2xlarge without autoscaling — review rightsizing',
                   jsonb_build_array(repo_id)
            FROM eol_risks
            WHERE resource_type = 'rds'
            LIMIT 1
            """
        )
        conn.commit()
        cur.close()
        conn.close()
    except Exception:
        pass


@app.get("/patterns/similar")
def similar_patterns(repo_id: str, top_k: int = 5):
    try:
        col = ensure_collection()
        col.load()
        expr = f'repo_id == "{repo_id}"'
        results = col.query(expr=expr, output_fields=["id", "repo_id", "chunk_type"], limit=1)
        if not results:
            return {"repo_id": repo_id, "neighbors": []}
        return {"repo_id": repo_id, "neighbors": results, "status": "ok"}
    except Exception as exc:
        return {"repo_id": repo_id, "neighbors": [], "status": "error", "error": str(exc)}


@app.post("/ingest/parse-result")
async def ingest_parse_result(body: dict[str, Any]):
    """Stage 6 async: embed stack profiles from parse results + interaction edges when present."""
    repo_id = body.get("repo_id", "")
    resources = body.get("resources", [])
    stacks = body.get("stacks", [])
    chunks = []
    for s in stacks:
        content = json.dumps({"source": s.get("source"), "inputs": s.get("inputs", {})})
        chunks.append(embed_chunk({"repo_id": repo_id, "chunk_type": "stack_profile", "content": content}))
    for r in resources[:20]:
        content = json.dumps({"type": r.get("type"), "name": r.get("name"), "attrs": r.get("attributes", {})})
        chunks.append(embed_chunk({"repo_id": repo_id, "chunk_type": "resource_pattern", "content": content}))

    interactions = body.get("interactions") or []
    interaction_result = None
    if interactions:
        try:
            interaction_result = ingest_interactions(interactions)
        except Exception as exc:
            interaction_result = {"status": "error", "error": str(exc)}

    return {
        "repo_id": repo_id,
        "chunks_embedded": len(chunks),
        "interactions": interaction_result,
    }


@app.get("/infra/milvus/status")
def infra_milvus_status():
    try:
        return {"status": "ok", **collection_stats()}
    except Exception as exc:
        return {"status": "error", "error": str(exc)}


@app.post("/infra/interactions/ingest")
def infra_interactions_ingest(body: dict[str, Any]):
    """Upsert exhaustive interaction signatures into Milvus infra_interactions."""
    interactions = body.get("interactions") or []
    if not isinstance(interactions, list):
        return {"status": "error", "error": "interactions must be a list"}
    try:
        ensure_interactions_collection()
        result = ingest_interactions(interactions)
        try:
            seed_canonical_patterns()
        except Exception:
            pass
        return result
    except Exception as exc:
        return {"status": "error", "error": str(exc), "count": 0}


@app.post("/infra/patterns/seed")
def infra_patterns_seed():
    try:
        return seed_canonical_patterns()
    except Exception as exc:
        return {"status": "error", "error": str(exc)}


@app.post("/infra/patterns/derive")
def infra_patterns_derive(body: dict[str, Any]):
    """Hybrid pattern derivation from interaction set (rules + vectors)."""
    interactions = body.get("interactions") or []
    family = body.get("family")
    hint = body.get("pattern_hint") or body.get("pattern_id")
    try:
        return derive_pattern(interactions, family=family, pattern_hint=hint)
    except Exception as exc:
        return {"status": "error", "error": str(exc)}


@app.post("/release-compare/analyze")
async def release_compare_analyze(body: dict[str, Any]):
    """Doc-aware upgrade recommendations for Raise PR (realtime AWS docs when reachable)."""
    return await analyze_release_change(body or {})


@app.post("/impact/narrate")
def impact_narrate(body: dict[str, Any]):
    """Evidence-only HOT impact narration. Echoes CLASS; no embeddings / no class invention."""
    try:
        return narrate_impact(body or {})
    except Exception as exc:
        return {"status": "error", "error": str(exc)}


@app.post("/release-compare/chat")
async def release_compare_chat(body: dict[str, Any]):
    """Scoped engineer chat for Raise PR workbench (paths, prereqs, impact, docs)."""
    return await chat_release_compare(body or {})
