"""
Layer-1 infra interaction vectors in Milvus.

Collections:
  - infra_interactions — exhaustive edge / traffic signatures from scans
  - infra_patterns     — canonical pattern template signatures

Hybrid derivation: family + HA rules first (accuracy), then vector similarity.
"""

from __future__ import annotations

import hashlib
import json
import os
from typing import Any

import numpy as np
from pymilvus import Collection, CollectionSchema, DataType, FieldSchema, connections, utility

MILVUS_URI = os.environ.get("MILVUS_URI", "http://localhost:19530")
DIM = int(os.environ.get("EMBEDDING_DIM", "64"))
INTERACTIONS_COLLECTION = "infra_interactions"
PATTERNS_COLLECTION = "infra_patterns"

# Canonical taxonomy mirrored from API pattern-classifier (rules layer).
CANONICAL_PATTERNS = [
    {
        "pattern_id": "PAT-RDS-PGSQL-SINGLE-AZ-STD",
        "family": "RDS-PGSQL",
        "tier": "simple",
        "port": "5432",
        "protocol": "tcp",
        "ha": False,
    },
    {
        "pattern_id": "PAT-RDS-PGSQL-MULTIAZ-HA",
        "family": "RDS-PGSQL",
        "tier": "complex",
        "port": "5432",
        "protocol": "tcp",
        "ha": True,
    },
    {
        "pattern_id": "PAT-RDS-MSSQL-SINGLE-AZ-STD",
        "family": "RDS-MSSQL",
        "tier": "simple",
        "port": "1433",
        "protocol": "tcp",
        "ha": False,
    },
    {
        "pattern_id": "PAT-RDS-MSSQL-MULTIAZ-HA",
        "family": "RDS-MSSQL",
        "tier": "complex",
        "port": "1433",
        "protocol": "tcp",
        "ha": True,
    },
    {
        "pattern_id": "PAT-RDS-APGSQL-SINGLE-WRITER",
        "family": "RDS-APGSQL",
        "tier": "simple",
        "port": "5432",
        "protocol": "tcp",
        "ha": False,
    },
    {
        "pattern_id": "PAT-RDS-APGSQL-HA-CLUSTER",
        "family": "RDS-APGSQL",
        "tier": "complex",
        "port": "5432",
        "protocol": "tcp",
        "ha": True,
    },
    {
        "pattern_id": "PAT-EC2-ORACLE-SINGLE",
        "family": "Ec2Oracle",
        "tier": "simple",
        "port": "1521",
        "protocol": "tcp",
        "ha": False,
    },
    {
        "pattern_id": "PAT-EC2-ORACLE-DR-PAIR",
        "family": "Ec2Oracle",
        "tier": "complex",
        "port": "1521",
        "protocol": "tcp",
        "ha": True,
    },
]


def connect_milvus() -> None:
    host = MILVUS_URI.replace("http://", "").replace("https://", "").split(":")[0]
    port = MILVUS_URI.split(":")[-1] if ":" in MILVUS_URI else "19530"
    connections.connect(alias="default", host=host, port=port)


def embed_text(text: str) -> list[float]:
    """Deterministic local embedding (same scheme as iac_patterns)."""
    h = hashlib.sha256(text.encode()).digest()
    arr = np.frombuffer(h, dtype=np.uint8).astype(np.float32)
    reps = int(np.ceil(DIM / len(arr)))
    vec = np.tile(arr, reps)[:DIM]
    vec = vec / (np.linalg.norm(vec) + 1e-9)
    return vec.tolist()


def _ensure_collection(name: str, description: str) -> Collection:
    connect_milvus()
    if utility.has_collection(name):
        return Collection(name)
    fields = [
        FieldSchema(name="id", dtype=DataType.VARCHAR, is_primary=True, max_length=64),
        FieldSchema(name="pattern_id", dtype=DataType.VARCHAR, max_length=128),
        FieldSchema(name="family", dtype=DataType.VARCHAR, max_length=64),
        FieldSchema(name="rel_type", dtype=DataType.VARCHAR, max_length=64),
        FieldSchema(name="repo_id", dtype=DataType.VARCHAR, max_length=128),
        FieldSchema(name="signature", dtype=DataType.VARCHAR, max_length=1024),
        FieldSchema(name="embedding", dtype=DataType.FLOAT_VECTOR, dim=DIM),
    ]
    schema = CollectionSchema(fields, description=description)
    col = Collection(name, schema)
    col.create_index(
        "embedding",
        {"index_type": "IVF_FLAT", "metric_type": "L2", "params": {"nlist": 128}},
    )
    return col


def ensure_interactions_collection() -> Collection:
    return _ensure_collection(INTERACTIONS_COLLECTION, "Exhaustive infra interaction signatures")


def ensure_patterns_collection() -> Collection:
    return _ensure_collection(PATTERNS_COLLECTION, "Canonical Layer-1 pattern template vectors")


def reset_infra_collections() -> dict[str, Any]:
    connect_milvus()
    dropped = []
    for name in (INTERACTIONS_COLLECTION, PATTERNS_COLLECTION):
        if utility.has_collection(name):
            utility.drop_collection(name)
            dropped.append(name)
    ensure_interactions_collection()
    ensure_patterns_collection()
    seed_canonical_patterns()
    return {"dropped": dropped, "collections": [INTERACTIONS_COLLECTION, PATTERNS_COLLECTION]}


def _upsert_rows(col: Collection, rows: list[dict[str, Any]]) -> int:
    if not rows:
        return 0
    # Delete existing ids then insert (Milvus standalone upsert-friendly)
    ids = [r["id"][:64] for r in rows]
    try:
        expr = "id in [" + ",".join(json.dumps(i) for i in ids) + "]"
        col.delete(expr)
    except Exception:
        pass
    col.insert(
        [
            [r["id"][:64] for r in rows],
            [r.get("pattern_id", "")[:128] for r in rows],
            [r.get("family", "")[:64] for r in rows],
            [r.get("rel_type", "")[:64] for r in rows],
            [r.get("repo_id", "")[:128] for r in rows],
            [r.get("signature", "")[:1024] for r in rows],
            [r["embedding"] for r in rows],
        ]
    )
    col.flush()
    return len(rows)


def interaction_to_row(rec: dict[str, Any]) -> dict[str, Any]:
    sig = rec.get("signature") or json.dumps(rec, sort_keys=True)[:900]
    rid = rec.get("id") or hashlib.md5(sig.encode()).hexdigest()
    return {
        "id": str(rid)[:64],
        "pattern_id": str(rec.get("pattern_id") or "")[:128],
        "family": str(rec.get("family") or "")[:64],
        "rel_type": str(rec.get("rel_type") or "")[:64],
        "repo_id": str(rec.get("repo_id") or "")[:128],
        "signature": str(sig)[:1024],
        "embedding": embed_text(str(sig)),
    }


def ingest_interactions(interactions: list[dict[str, Any]]) -> dict[str, Any]:
    col = ensure_interactions_collection()
    rows = [interaction_to_row(r) for r in interactions]
    count = _upsert_rows(col, rows)
    return {
        "status": "upserted",
        "collection": INTERACTIONS_COLLECTION,
        "count": count,
        "dim": DIM,
    }


def seed_canonical_patterns() -> dict[str, Any]:
    col = ensure_patterns_collection()
    rows = []
    for p in CANONICAL_PATTERNS:
        sigs = [
            f"in_vpc|subnet|vpc|{p['family']}|{p['pattern_id']}",
            f"uses_sg|workload|sg|{p['family']}|{p['pattern_id']}",
            f"allows_cidr|ingress|{p['port']}|{p['protocol']}|{p['family']}|{p['pattern_id']}",
            f"allows_cidr|egress|all|all|{p['family']}|{p['pattern_id']}",
            (
                f"fact|multi-az|ha|{p['family']}|{p['pattern_id']}"
                if p["ha"]
                else f"fact|single-az|std|{p['family']}|{p['pattern_id']}"
            ),
        ]
        for i, sig in enumerate(sigs):
            rid = hashlib.sha256(f"{p['pattern_id']}:canonical:{i}:{sig}".encode()).hexdigest()[:48]
            rows.append(
                {
                    "id": rid,
                    "pattern_id": p["pattern_id"],
                    "family": p["family"],
                    "rel_type": "CANONICAL",
                    "repo_id": "",
                    "signature": sig,
                    "embedding": embed_text(sig),
                }
            )
    count = _upsert_rows(col, rows)
    return {"status": "seeded", "collection": PATTERNS_COLLECTION, "count": count}


def collection_stats() -> dict[str, Any]:
    connect_milvus()
    out: dict[str, Any] = {"uri": MILVUS_URI, "dim": DIM, "collections": {}}
    for name in (INTERACTIONS_COLLECTION, PATTERNS_COLLECTION, "iac_patterns"):
        if utility.has_collection(name):
            col = Collection(name)
            try:
                col.flush()
                out["collections"][name] = {"exists": True, "num_entities": col.num_entities}
            except Exception as exc:
                out["collections"][name] = {"exists": True, "error": str(exc)}
        else:
            out["collections"][name] = {"exists": False, "num_entities": 0}
    return out


def _rule_match(interactions: list[dict[str, Any]], family: str | None) -> dict[str, Any] | None:
    """Accuracy-first: family + HA signals / ports decide Simple vs Complex."""
    if not interactions and not family:
        return None
    fam = family or (interactions[0].get("family") if interactions else None)
    if not fam:
        return None

    text = " ".join(
        " ".join(
            [
                str(i.get("signature", "")),
                str(i.get("signals", "")),
                str(i.get("multi_az", "")),
                str(i.get("rel_type", "")),
                str(i.get("port", "")),
            ]
        )
        for i in interactions
    ).lower()

    ha = any(
        token in text
        for token in (
            "multi_az",
            "multi-az",
            "replica",
            "standby",
            "dr_pair",
            "ha_cluster",
            "fact|multi-az",
            "multiaz",
        )
    )
    # Also respect pattern_id already on records
    for i in interactions:
        pid = str(i.get("pattern_id") or "")
        if "MULTIAZ" in pid or "HA-CLUSTER" in pid or "DR-PAIR" in pid:
            ha = True
        if pid.endswith("-STD") or pid.endswith("-SINGLE") or "SINGLE-WRITER" in pid or "SINGLE-AZ" in pid:
            # only force simple if no HA signals
            pass

    candidates = [p for p in CANONICAL_PATTERNS if p["family"] == fam]
    if not candidates:
        return None
    chosen = next((p for p in candidates if p["ha"] == ha), candidates[0])
    ports = {str(i.get("port")) for i in interactions if i.get("port")}
    expected_port = chosen["port"]
    port_ok = not ports or expected_port in ports or "all" in ports
    return {
        "pattern_id": chosen["pattern_id"],
        "family": chosen["family"],
        "tier": chosen["tier"],
        "method": "rules",
        "ha_detected": ha,
        "port_match": port_ok,
        "expected_port": expected_port,
        "observed_ports": sorted(ports),
        "interaction_count": len(interactions),
    }


def _vector_neighbors(interactions: list[dict[str, Any]], top_k: int = 5) -> list[dict[str, Any]]:
    if not interactions:
        return []
    # Aggregate signature for the interaction set (sorted unique rels + ports)
    parts = sorted(
        {
            f"{i.get('rel_type', '')}|{i.get('direction', '')}|{i.get('port', '')}|{i.get('protocol', '')}|{i.get('family', '')}"
            for i in interactions
        }
    )
    agg = "||".join(parts) or interactions[0].get("signature", "")
    vec = embed_text(agg)
    col = ensure_patterns_collection()
    col.load()
    results = col.search(
        data=[vec],
        anns_field="embedding",
        param={"metric_type": "L2", "params": {"nprobe": 16}},
        limit=top_k,
        output_fields=["pattern_id", "family", "signature", "rel_type"],
    )
    neighbors = []
    for hits in results:
        for hit in hits:
            entity = hit.entity
            neighbors.append(
                {
                    "pattern_id": entity.get("pattern_id"),
                    "family": entity.get("family"),
                    "signature": entity.get("signature"),
                    "distance": float(hit.distance),
                    "id": hit.id,
                }
            )
    return neighbors


def derive_pattern(
    interactions: list[dict[str, Any]],
    family: str | None = None,
    pattern_hint: str | None = None,
) -> dict[str, Any]:
    """Hybrid: rules for accuracy, vectors for similarity confirmation."""
    ensure_patterns_collection()
    try:
        seed_canonical_patterns()
    except Exception:
        pass

    rule = _rule_match(interactions, family)
    neighbors: list[dict[str, Any]] = []
    try:
        neighbors = _vector_neighbors(interactions, top_k=8)
    except Exception as exc:
        neighbors = []
        vector_error = str(exc)
    else:
        vector_error = None

    # Vote among neighbors in same family
    votes: dict[str, int] = {}
    fam = (rule or {}).get("family") or family
    for n in neighbors:
        if fam and n.get("family") and n["family"] != fam:
            continue
        pid = n.get("pattern_id")
        if pid:
            votes[pid] = votes.get(pid, 0) + 1
    vector_pick = max(votes, key=votes.get) if votes else (neighbors[0]["pattern_id"] if neighbors else None)

    derived = (rule or {}).get("pattern_id")
    # Prefer rules; if vectors strongly agree with a different HA twin in family, keep rules
    # unless hint forces (auditor override path)
    if pattern_hint:
        derived = pattern_hint
        method = "hint+rules"
    elif rule:
        derived = rule["pattern_id"]
        method = "hybrid" if vector_pick else "rules"
        if vector_pick and vector_pick != derived:
            # Keep rules for accuracy; surface disagreement
            method = "hybrid_rules_preferred"
    else:
        derived = vector_pick
        method = "vectors" if vector_pick else "none"

    return {
        "status": "ok" if derived else "no_match",
        "derived_pattern_id": derived,
        "method": method,
        "rules": rule,
        "vector_neighbors": neighbors[:5],
        "vector_vote": vector_pick,
        "vector_error": vector_error,
        "interaction_count": len(interactions),
        "accuracy_note": "Rules (family/HA/ports) take precedence over vector similarity to avoid missing interactions.",
    }
