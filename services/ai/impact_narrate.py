"""Evidence-only impact narration for HOT PR/tag reports.

Deterministic formatter — no embeddings / Milvus. Echoes the classifier CLASS
unchanged. Optional LLM hook can be added later behind the same contract.
"""

from __future__ import annotations

from typing import Any


def narrate_impact(body: dict[str, Any] | None) -> dict[str, Any]:
    body = body or {}
    evidence = body.get("evidence") or {}
    if not isinstance(evidence, dict):
        evidence = {}

    cls = str(evidence.get("class") or body.get("class") or "UNKNOWN").strip().upper()
    if cls not in ("BREAKING", "NON_BREAKING", "UNKNOWN"):
        cls = "UNKNOWN"

    module_id = evidence.get("module_id") or "module"
    consumer_repo = evidence.get("consumer_repo_id")  # may be absent from evidence-only payload
    # Platform buildNarrationUserPayload does not include consumer_repo_id; that's fine —
    # narration stays grounded in the fields that were sent.
    current_pin = evidence.get("current_pin")
    target = evidence.get("target_version") or ""
    locations = evidence.get("locations") or []
    breaking = evidence.get("breaking_reasons") or []
    staleness = evidence.get("staleness") or {}
    summary = evidence.get("contract_diff_summary")

    loc_bits: list[str] = []
    if isinstance(locations, list):
        for loc in locations:
            if not isinstance(loc, dict):
                continue
            f = loc.get("file") or ""
            line = loc.get("line")
            loc_bits.append(f"{f}:{line}" if line else str(f))
    loc_str = ", ".join(x for x in loc_bits if x)

    if cls == "UNKNOWN":
        reason = "insufficient_evidence"
        if isinstance(staleness, dict) and staleness.get("reason"):
            reason = str(staleness.get("reason"))
        who = f"{consumer_repo} on " if consumer_repo else ""
        headline = f"UNKNOWN impact for {who}{module_id} → {target}"
        detail = (
            f"Cannot classify ({reason}). Contracts or graph are not trustworthy for this analysis. "
            "An async refresh has been requested; re-run after it completes. No guess is made."
        )
    elif cls == "BREAKING":
        reasons: list[str] = []
        if isinstance(breaking, list):
            for r in breaking:
                if isinstance(r, dict):
                    reasons.append(
                        f"{str(r.get('kind') or '').replace('_', ' ')}: {r.get('input')}"
                    )
        reason_str = "; ".join(reasons) if reasons else "see evidence"
        pin = current_pin or "unpinned"
        who = f"{consumer_repo}: " if consumer_repo else ""
        headline = f"BREAKING for {who}{pin} → {target}"
        detail = f"{module_id} interface change breaks this consumer. Evidence: {reason_str}."
        if loc_str:
            detail += f" Locations: {loc_str}."
    else:
        if isinstance(summary, dict):
            optional = (
                f"{summary.get('added', 0)} added, {summary.get('changed', 0)} changed, "
                f"{summary.get('outputsAdded', 0)} outputs added"
            )
        else:
            optional = "no interface change"
        pin = current_pin or "unpinned"
        who = f"{consumer_repo}: " if consumer_repo else ""
        headline = f"NON_BREAKING for {who}{pin} → {target}"
        detail = (
            f"{module_id} change is compatible with this consumer's provided inputs ({optional})."
        )
        if loc_str:
            detail += f" Locations: {loc_str}."

    return {
        "status": "ok",
        "class": cls,
        "headline": headline,
        "detail": detail,
        "source": "ai_service",
        "grounded": True,
        "echo_class_only": True,
    }
