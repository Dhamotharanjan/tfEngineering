"""Release-compare PR analysis with realtime AWS documentation fetch."""

from __future__ import annotations

import re
from typing import Any

import httpx


# Official AWS docs — only cite URLs that are fetched successfully (or known offline catalog).
AWS_DOC_CATALOG: dict[str, dict[str, str]] = {
    "rds_upgrade": {
        "title": "Upgrading a DB instance engine version",
        "url": "https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_UpgradeDBInstance.Upgrading.html",
    },
    "rds_multiaz": {
        "title": "Multi-AZ DB instance deployments",
        "url": "https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Concepts.MultiAZ.html",
    },
    "rds_blue_green": {
        "title": "Blue/Green Deployments for Aurora and Amazon RDS",
        "url": "https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/blue-green-deployments.html",
    },
    "rds_maintenance": {
        "title": "Maintaining a DB instance",
        "url": "https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_UpgradeDBInstance.Maintenance.html",
    },
    "rds_snapshot": {
        "title": "Creating a DB snapshot for a Single-AZ DB instance",
        "url": "https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_CreateSnapshot.html",
    },
    "ec2_ami": {
        "title": "Amazon Machine Images (AMI)",
        "url": "https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/AMIs.html",
    },
    "ec2_replace_root": {
        "title": "Replace the root volume for an Amazon EC2 instance",
        "url": "https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/replace-root-volume.html",
    },
    "asg_rolling": {
        "title": "Instance refresh for Auto Scaling groups",
        "url": "https://docs.aws.amazon.com/autoscaling/ec2/userguide/asg-instance-refresh.html",
    },
    "eks_upgrade": {
        "title": "Updating an Amazon EKS cluster Kubernetes version",
        "url": "https://docs.aws.amazon.com/eks/latest/userguide/update-cluster.html",
    },
}

USER_AGENT = "InfraGraph-ReleaseCompare/1.0 (+https://github.com/local/tfEngineering)"

STATUS_PASS = "pass"
STATUS_FAIL = "fail"
STATUS_UNKNOWN = "unknown"
STATUS_NA = "not_applicable"


def _parse_semverish(version: str | None) -> tuple[int, ...] | None:
    if not version:
        return None
    nums = re.findall(r"\d+", str(version))
    if not nums:
        return None
    return tuple(int(n) for n in nums[:4])


def _is_major_bump(from_v: str | None, to_v: str | None) -> bool:
    a, b = _parse_semverish(from_v), _parse_semverish(to_v)
    if not a or not b:
        return False
    return a[0] != b[0]


def _truthy(val: Any) -> bool:
    if isinstance(val, bool):
        return val
    if val is None:
        return False
    return str(val).lower() in ("true", "1", "yes", "on")


def _collect_resource_signals(resources: list[dict[str, Any]]) -> dict[str, Any]:
    types: set[str] = set()
    multi_az = False
    engines: list[str] = []
    engine_versions: list[str] = []
    instance_classes: list[str] = []
    amis: list[str] = []
    snapshot_ids: list[str] = []
    snapshot_attrs_seen = False
    addresses: list[str] = []
    for r in resources or []:
        rtype = str(r.get("type") or "")
        types.add(rtype)
        addresses.append(str(r.get("address") or r.get("name") or rtype))
        attrs = r.get("attributes") or {}
        if not isinstance(attrs, dict):
            attrs = {}
        if _truthy(attrs.get("multi_az") or attrs.get("multiAZ") or attrs.get("MultiAZ")):
            multi_az = True
        if attrs.get("engine"):
            engines.append(str(attrs["engine"]))
        if attrs.get("engine_version"):
            engine_versions.append(str(attrs["engine_version"]))
        if attrs.get("instance_class"):
            instance_classes.append(str(attrs["instance_class"]))
        for ami_key in ("ami", "ami_id", "image_id", "ami_id_oracle"):
            if attrs.get(ami_key):
                amis.append(str(attrs[ami_key]))
        for snap_key in (
            "snapshot_identifier",
            "final_snapshot_identifier",
            "db_snapshot_identifier",
            "snapshot_id",
            "source_db_snapshot_identifier",
        ):
            if snap_key in attrs:
                snapshot_attrs_seen = True
                if attrs.get(snap_key):
                    snapshot_ids.append(str(attrs[snap_key]))
        if _truthy(attrs.get("skip_final_snapshot")) is False and "skip_final_snapshot" in attrs:
            snapshot_attrs_seen = True
    return {
        "resource_types": sorted(types),
        "resource_addresses": addresses[:20],
        "multi_az_enabled": multi_az,
        "engines": engines,
        "engine_versions": engine_versions,
        "instance_classes": instance_classes,
        "amis": amis,
        "snapshot_ids": snapshot_ids,
        "snapshot_attrs_seen": snapshot_attrs_seen,
        "has_rds": any(t in ("aws_db_instance", "aws_rds_cluster", "aws_rds_cluster_instance") for t in types),
        "has_ec2": "aws_instance" in types,
        "has_asg": "aws_autoscaling_group" in types,
        "has_launch_template": "aws_launch_template" in types,
        "has_eks": any("eks" in t for t in types),
    }


def _infer_from_diff(diff_summary: dict[str, Any], from_vars: list, to_vars: list) -> dict[str, Any]:
    """Infer upgrade category from module contract variable changes."""
    from_map = {v.get("name"): v for v in (from_vars or []) if isinstance(v, dict)}
    to_map = {v.get("name"): v for v in (to_vars or []) if isinstance(v, dict)}

    engine_from = (from_map.get("engine_version") or {}).get("default")
    engine_to = (to_map.get("engine_version") or {}).get("default")
    multi_from = (from_map.get("multi_az") or {}).get("default")
    multi_to = (to_map.get("multi_az") or {}).get("default")
    ami_hints = []
    ami_from = None
    ami_to = None
    for name in ("ami", "ami_id", "image_id", "os_version", "ami_id_oracle"):
        if name in to_map or name in from_map:
            ami_hints.append(name)
        fv = (from_map.get(name) or {}).get("default")
        tv = (to_map.get(name) or {}).get("default")
        if fv is not None:
            ami_from = fv
        if tv is not None:
            ami_to = tv

    categories: list[str] = []
    if engine_from is not None or engine_to is not None:
        if _is_major_bump(str(engine_from) if engine_from is not None else None, str(engine_to) if engine_to is not None else None):
            categories.append("Major Version Upgrade (RDS engine)")
        elif engine_from != engine_to and engine_to is not None:
            categories.append("Minor Version Upgrade (RDS engine)")
        else:
            categories.append("RDS configuration change")

    if ami_hints:
        categories.append("OS / AMI Version Upgrade")

    if _truthy(multi_to) and not _truthy(multi_from):
        categories.append("Multi-AZ enablement")
    elif _truthy(multi_to) or _truthy(multi_from):
        categories.append("Multi-AZ aware change")

    breaking = int((diff_summary or {}).get("breaking") or 0)
    if not categories and breaking:
        categories.append("Breaking module interface change")
    if not categories:
        categories.append("Module pin bump")

    return {
        "categories": categories,
        "engine_from": engine_from,
        "engine_to": engine_to,
        "multi_az_from": multi_from,
        "multi_az_to": multi_to,
        "ami_hints": ami_hints,
        "ami_from": ami_from,
        "ami_to": ami_to,
        "major_engine_bump": _is_major_bump(
            str(engine_from) if engine_from is not None else None,
            str(engine_to) if engine_to is not None else None,
        ),
    }


async def fetch_aws_docs(keys: list[str], timeout: float = 8.0) -> tuple[list[dict[str, Any]], str]:
    """Fetch official AWS docs pages. Returns (citations, docs_source)."""
    citations: list[dict[str, Any]] = []
    fetched = 0
    errors = 0
    async with httpx.AsyncClient(
        timeout=timeout,
        follow_redirects=True,
        headers={"User-Agent": USER_AGENT, "Accept": "text/html"},
    ) as client:
        for key in keys:
            meta = AWS_DOC_CATALOG.get(key)
            if not meta:
                continue
            entry: dict[str, Any] = {
                "key": key,
                "title": meta["title"],
                "url": meta["url"],
                "fetched": False,
            }
            try:
                resp = await client.get(meta["url"])
                if resp.status_code == 200 and len(resp.text) > 500:
                    entry["fetched"] = True
                    # Extract a short plain-text snippet (strip tags lightly)
                    text = re.sub(r"<script[\s\S]*?</script>", " ", resp.text, flags=re.I)
                    text = re.sub(r"<style[\s\S]*?</style>", " ", text, flags=re.I)
                    text = re.sub(r"<[^>]+>", " ", text)
                    text = re.sub(r"\s+", " ", text).strip()
                    entry["snippet"] = text[:400]
                    fetched += 1
                else:
                    entry["error"] = f"HTTP {resp.status_code}"
                    errors += 1
            except Exception as exc:  # noqa: BLE001
                entry["error"] = str(exc)[:200]
                errors += 1
            citations.append(entry)

    if fetched and not errors:
        source = "live"
    elif fetched and errors:
        source = "cached"  # partial live + catalog titles
    elif errors and not fetched:
        source = "error"
    else:
        source = "offline"
    return citations, source


def _pick_doc_keys(signals: dict[str, Any], inferred: dict[str, Any]) -> list[str]:
    keys: list[str] = []
    if signals.get("has_rds") or inferred.get("engine_from") is not None or inferred.get("engine_to") is not None:
        keys.extend(["rds_upgrade", "rds_maintenance", "rds_blue_green", "rds_snapshot"])
        if signals.get("multi_az_enabled") or _truthy(inferred.get("multi_az_to")) or _truthy(inferred.get("multi_az_from")):
            keys.append("rds_multiaz")
    if signals.get("has_ec2") or signals.get("has_launch_template") or "OS / AMI Version Upgrade" in inferred.get("categories", []):
        keys.extend(["ec2_ami", "ec2_replace_root"])
    if signals.get("has_asg"):
        keys.append("asg_rolling")
    if signals.get("has_eks"):
        keys.append("eks_upgrade")
    if not keys:
        # Generic infra change — still pull RDS + EC2 maintenance guidance as common paths
        keys = ["rds_upgrade", "rds_blue_green", "rds_snapshot", "ec2_ami"]
    # Preserve order, unique
    seen: set[str] = set()
    out: list[str] = []
    for k in keys:
        if k not in seen:
            seen.add(k)
            out.append(k)
    return out


def _build_prerequisites(
    *,
    signals: dict[str, Any],
    inferred: dict[str, Any],
    paths_applicable: bool,
) -> dict[str, Any]:
    """Hard prerequisite checklist for in-place / new-instance+migrate paths."""
    has_rds = bool(signals.get("has_rds")) or inferred.get("engine_to") is not None
    has_ec2 = bool(signals.get("has_ec2") or signals.get("has_launch_template")) or bool(
        inferred.get("ami_hints")
    )
    categories = inferred.get("categories") or []
    disruptive = paths_applicable or has_rds or has_ec2 or any(
        c for c in categories if c not in ("Module pin bump",)
    )

    # --- Snapshot ---
    if not disruptive:
        snapshot_required = False
    elif has_rds or inferred.get("engine_to") is not None or inferred.get("major_engine_bump"):
        snapshot_required = True
    elif has_ec2 and "OS / AMI Version Upgrade" in categories:
        snapshot_required = True  # EBS / root volume safety before AMI cutover
    else:
        snapshot_required = bool(paths_applicable)

    snapshot_ids = signals.get("snapshot_ids") or []
    snapshot_attrs_seen = bool(signals.get("snapshot_attrs_seen"))
    if not snapshot_required:
        snapshot_status = STATUS_NA
        snapshot_evidence = "Snapshot not required for this non-disruptive module pin bump (verify terraform plan)."
    elif snapshot_ids:
        snapshot_status = STATUS_PASS
        snapshot_evidence = f"Snapshot identifier(s) found in TF attributes: {', '.join(snapshot_ids[:5])}"
    elif snapshot_attrs_seen:
        snapshot_status = STATUS_FAIL
        snapshot_evidence = (
            "Snapshot-related attributes present but empty/skip — engineer must plan and verify a pre-change snapshot."
        )
    else:
        snapshot_status = STATUS_UNKNOWN
        snapshot_evidence = "not found in graph — engineer must confirm SNAPSHOT is taken/verified before change"

    # --- AMI ---
    ami_required = bool(
        has_ec2
        or "OS / AMI Version Upgrade" in categories
        or inferred.get("ami_hints")
        or (has_rds and any("oracle" in str(e).lower() for e in (signals.get("engines") or [])))
    )
    amis = signals.get("amis") or []
    ami_to = inferred.get("ami_to")
    ami_from = inferred.get("ami_from")
    if not ami_required:
        ami_status = STATUS_NA
        ami_evidence = "AMI check not applicable (no EC2/AMI/OS upgrade signals detected)."
    elif amis or ami_to:
        ami_status = STATUS_PASS
        parts = []
        if amis:
            parts.append(f"AMI in resource attrs: {', '.join(amis[:5])}")
        if ami_from is not None or ami_to is not None:
            parts.append(f"module contract ami {ami_from} → {ami_to}")
        ami_evidence = "; ".join(parts)
    elif inferred.get("ami_hints"):
        ami_status = STATUS_UNKNOWN
        ami_evidence = (
            f"AMI variables in contract ({', '.join(inferred['ami_hints'])}) but no concrete AMI id in graph — "
            "engineer must confirm golden AMI / Oracle AMI before proceed"
        )
    else:
        ami_status = STATUS_UNKNOWN
        ami_evidence = "not found in graph — engineer must confirm AMI (EC2/Oracle golden image) before proceed"

    checklist = [
        {
            "id": "snapshot",
            "key": "snapshot_required",
            "label": "SNAPSHOT required before change",
            "required": snapshot_required,
            "status": snapshot_status,
            "evidence": snapshot_evidence,
            "recommendation": (
                "Take and verify a DB/EBS snapshot (or confirm final_snapshot_identifier) before apply; "
                "do not proceed until snapshot_status is pass."
                if snapshot_required
                else "No hard snapshot gate for this change class."
            ),
        },
        {
            "id": "ami",
            "key": "ami_required",
            "label": "AMI / golden image verified",
            "required": ami_required,
            "status": ami_status,
            "evidence": ami_evidence,
            "recommendation": (
                "Confirm target AMI id (EC2/Oracle golden image) exists in the account/region and is approved "
                "before raise/merge."
                if ami_required
                else "AMI prerequisite not applicable."
            ),
        },
    ]

    return {
        "snapshot_required": snapshot_required,
        "snapshot_status": snapshot_status,
        "snapshot_evidence": snapshot_evidence,
        "ami_required": ami_required,
        "ami_status": ami_status,
        "ami_evidence": ami_evidence,
        "checklist": checklist,
        "blocking": [
            item["id"]
            for item in checklist
            if item["required"] and item["status"] in (STATUS_FAIL, STATUS_UNKNOWN)
        ],
    }


def _build_upgrade_paths(
    *,
    signals: dict[str, Any],
    inferred: dict[str, Any],
    requires_restart: bool,
    downtime_required: bool,
) -> list[dict[str, Any]]:
    categories = inferred.get("categories") or []
    has_rds = bool(signals.get("has_rds")) or inferred.get("engine_to") is not None
    has_ec2 = bool(signals.get("has_ec2") or signals.get("has_launch_template")) or "OS / AMI Version Upgrade" in categories
    major = bool(inferred.get("major_engine_bump"))
    multi_az = bool(signals.get("multi_az_enabled")) or _truthy(inferred.get("multi_az_to")) or _truthy(
        inferred.get("multi_az_from")
    )

    # Prefer Path B for major RDS / AMI replace; Path A for minor / Multi-AZ in-place when safe.
    prefer_migrate = bool(major or (has_ec2 and "OS / AMI Version Upgrade" in categories))
    prefer_inplace = bool(has_rds and not major) or (not prefer_migrate and (has_rds or has_ec2))

    path_a = {
        "id": "inplace",
        "name": "Path A: In-place upgrade",
        "recommended": prefer_inplace and not prefer_migrate,
        "requires_restart": requires_restart,
        "requires_downtime": downtime_required,
        "summary": (
            "Modify the existing resource in place (engine upgrade / AMI replace / terraform apply on current instance). "
            "Expect restart or brief failover; schedule a maintenance window."
            if (has_rds or has_ec2)
            else "Apply the module pin bump in place; validate terraform plan for replace vs update."
        ),
        "when_to_use": (
            "Minor engine upgrades, non-destructive attribute changes, or Multi-AZ in-place upgrades where AWS "
            "handles standby-first failover."
            if has_rds
            else "When instance replacement is unnecessary and downtime is acceptable within a window."
        ),
        "steps": [
            "Confirm SNAPSHOT (+ AMI if EC2) prerequisites are pass.",
            "Schedule maintenance window; notify owners.",
            "If Multi-AZ RDS: rely on standby-first upgrade order, then failover.",
            "Apply terraform / modify-db-instance; monitor reboot/failover.",
            "Validate app reconnect and health before closing window.",
        ],
        "prerequisites_gate": ["snapshot", "ami"] if has_ec2 else ["snapshot"] if has_rds else [],
    }

    path_b = {
        "id": "new_instance_migrate",
        "name": "Path B: Build new instance and move data",
        "recommended": prefer_migrate,
        "requires_restart": True,
        "requires_downtime": True,
        "summary": (
            "Blue/green or replace: build a new instance (or green environment) on the target version/AMI, "
            "migrate or sync data, cut over endpoint/DNS, then decommission the old instance."
        ),
        "when_to_use": (
            "Major engine upgrades, Oracle/EC2 AMI golden-image cutovers, or when in-place risk/downtime is unacceptable."
        ),
        "steps": [
            "Confirm SNAPSHOT (+ AMI golden image) prerequisites are pass.",
            "Provision new instance / green environment on target version or AMI.",
            "Restore or replicate data; run validation / soak tests.",
            "Cut over DNS/endpoint during a controlled window (brief connection drain).",
            "Decommission old instance only after rollback point is confirmed.",
        ],
        "prerequisites_gate": ["snapshot", "ami"] if (has_ec2 or has_rds) else ["snapshot"],
        "aliases": ["blue_green", "replace", "snapshot_restore"],
    }

    if not has_rds and not has_ec2:
        path_a["recommended"] = True
        path_b["recommended"] = False
        path_a["summary"] = (
            "Standard in-place module pin bump — still review plan; Path B only if resources would be replaced."
        )

    # Annotate Multi-AZ preference on Path A
    if multi_az and has_rds:
        path_a["multi_az_note"] = (
            "Multi-AZ detected: in-place engine upgrades follow secondary → failover → former primary."
        )

    return [path_a, path_b]


def build_recommendations(
    *,
    signals: dict[str, Any],
    inferred: dict[str, Any],
    citations: list[dict[str, Any]],
    docs_source: str,
    module_id: str,
    from_version: str,
    to_version: str,
    repo_id: str,
) -> dict[str, Any]:
    categories = inferred.get("categories") or ["Module pin bump"]
    primary = categories[0]
    multi_az = bool(signals.get("multi_az_enabled")) or _truthy(inferred.get("multi_az_to")) or _truthy(
        inferred.get("multi_az_from")
    )
    major = bool(inferred.get("major_engine_bump"))
    has_rds = bool(signals.get("has_rds")) or inferred.get("engine_to") is not None

    downtime_required = False
    requires_restart = False
    estimated_duration = "none expected beyond terraform apply"
    rationale: list[str] = []

    if major and has_rds:
        downtime_required = True
        requires_restart = True
        estimated_duration = "10–30 minutes typical for major engine upgrade (failover + recovery); plan a maintenance window"
        rationale.append(
            f"Major RDS engine version change detected ({inferred.get('engine_from')} → {inferred.get('engine_to')})."
        )
    elif has_rds and "Minor Version Upgrade" in primary:
        downtime_required = True
        requires_restart = True
        estimated_duration = "5–15 minutes (brief failover if Multi-AZ; longer if Single-AZ)"
        rationale.append("Minor RDS engine upgrade typically causes a short outage or failover (restart).")
    elif "OS / AMI Version Upgrade" in categories:
        downtime_required = True
        requires_restart = True
        estimated_duration = "5–20 minutes per instance (replace/reboot); rolling can reduce blast radius"
        rationale.append("AMI/OS upgrade requires instance replacement or reboot.")
    elif "Multi-AZ enablement" in categories:
        downtime_required = True
        requires_restart = True
        estimated_duration = "several minutes during Multi-AZ conversion (AWS performs reboot/failover)"
        rationale.append("Enabling Multi-AZ converts the instance and may cause brief downtime / reboot.")
    elif has_rds:
        downtime_required = False
        requires_restart = False
        estimated_duration = "usually none if only non-disruptive settings; verify plan for storage/class changes"
        rationale.append("RDS present but no clear major/minor engine bump in contract defaults.")
    else:
        downtime_required = False
        requires_restart = False
        estimated_duration = "typically none for interface-only module bumps; validate terraform plan"
        rationale.append("No disruptive AWS resource upgrade pattern clearly detected from attributes/diff.")

    upgrade_paths = _build_upgrade_paths(
        signals=signals,
        inferred=inferred,
        requires_restart=requires_restart,
        downtime_required=downtime_required,
    )
    paths_applicable = any(p.get("recommended") for p in upgrade_paths) or has_rds or bool(
        signals.get("has_ec2")
    )
    prerequisites = _build_prerequisites(
        signals=signals,
        inferred=inferred,
        paths_applicable=bool(paths_applicable and (requires_restart or downtime_required or has_rds)),
    )

    multi_az_plan: dict[str, Any] | None = None
    if multi_az and has_rds:
        multi_az_plan = {
            "applicable": True,
            "order": [
                "Prefer blue/green or staged rollout so the standby (secondary) path is validated first.",
                "For Multi-AZ in-place engine upgrades, AWS upgrades the standby first, then fails over to make it primary, then upgrades the former primary — schedule during a maintenance window.",
                "Validate application reconnect / DNS endpoint behavior after failover.",
                "Only then treat the new primary as healthy and proceed with dependent stack applies.",
            ],
            "summary": "Secondary (standby) first, then failover to promote, then former primary — do not apply disruptive changes to the active writer alone when Multi-AZ is enabled.",
        }
        rationale.append("Multi-AZ is enabled or becoming enabled — follow secondary-then-primary safe order.")
    elif has_rds:
        multi_az_plan = {
            "applicable": False,
            "order": [
                "Single-AZ: expect longer downtime for engine upgrades; consider enabling Multi-AZ before major upgrades or use blue/green.",
            ],
            "summary": "Multi-AZ not detected on impacted resources; upgrades are more disruptive on Single-AZ.",
        }

    alternatives: list[dict[str, str]] = []
    if has_rds:
        alternatives.extend(
            [
                {
                    "name": "Blue/Green deployment",
                    "description": "Create a green environment, upgrade there, switch over with controlled cutover — recommended for major engine upgrades.",
                },
                {
                    "name": "Snapshot + restore",
                    "description": "Take a final snapshot, restore to a new instance on the target engine version, cut over DNS/endpoint, then decommission the old instance.",
                },
                {
                    "name": "In-place with maintenance window",
                    "description": "Apply modify-db-instance / terraform during a defined maintenance window; Multi-AZ shortens perceived downtime via failover.",
                },
            ]
        )
    if signals.get("has_ec2") or "OS / AMI Version Upgrade" in categories:
        alternatives.append(
            {
                "name": "Rolling instance refresh",
                "description": "For ASG-backed fleets, use instance refresh to roll AMI updates without full outage.",
            }
        )
    if not alternatives:
        alternatives.append(
            {
                "name": "Standard terraform apply",
                "description": "Review plan carefully; no special AWS upgrade pattern detected beyond module pin bump.",
            }
        )

    recommended_path = next((p for p in upgrade_paths if p.get("recommended")), upgrade_paths[0])
    summary = (
        f"Upgrade {module_id} {from_version} → {to_version} for repo `{repo_id}`: "
        f"{'; '.join(categories)}. Restart required: {'yes' if requires_restart else 'no'}; "
        f"downtime: {'yes' if downtime_required else 'no'} ({estimated_duration}). "
        f"Recommended path: {recommended_path.get('name')}. "
        f"Prereqs — snapshot: {prerequisites['snapshot_status']}, AMI: {prerequisites['ami_status']}. "
        f"Docs source: {docs_source}."
    )

    return {
        "downtime_required": downtime_required,
        "requires_restart": requires_restart,
        "estimated_duration": estimated_duration,
        "upgrade_category": primary,
        "upgrade_categories": categories,
        "upgrade_paths": upgrade_paths,
        "recommended_path_id": recommended_path.get("id"),
        "prerequisites": prerequisites,
        "multi_az_plan": multi_az_plan,
        "alternatives": alternatives,
        "doc_citations": [
            {
                "title": c["title"],
                "url": c["url"],
                "fetched": c.get("fetched", False),
                "snippet": c.get("snippet"),
                "key": c.get("key"),
            }
            for c in citations
        ],
        "docs_source": docs_source,
        "rationale": rationale,
        "resource_signals": {
            "resource_types": signals.get("resource_types"),
            "resource_addresses": signals.get("resource_addresses"),
            "multi_az_enabled": multi_az,
            "engine_versions": signals.get("engine_versions")
            or [inferred.get("engine_from"), inferred.get("engine_to")],
            "instance_classes": signals.get("instance_classes"),
            "amis": signals.get("amis"),
        },
        "summary": summary,
    }


async def analyze_release_change(body: dict[str, Any]) -> dict[str, Any]:
    module_id = body.get("module_id") or "unknown"
    from_version = body.get("from_version") or ""
    to_version = body.get("to_version") or ""
    repo_id = body.get("repo_id") or "unknown"
    diff_summary = body.get("diff_summary") or {}
    from_vars = body.get("from_variables") or []
    to_vars = body.get("to_variables") or []
    resources = body.get("resources") or []

    signals = _collect_resource_signals(resources)
    inferred = _infer_from_diff(diff_summary, from_vars, to_vars)
    doc_keys = _pick_doc_keys(signals, inferred)

    try:
        citations, docs_source = await fetch_aws_docs(doc_keys)
    except Exception as exc:  # noqa: BLE001
        citations = [
            {"key": k, "title": AWS_DOC_CATALOG[k]["title"], "url": AWS_DOC_CATALOG[k]["url"], "fetched": False, "error": str(exc)[:200]}
            for k in doc_keys
            if k in AWS_DOC_CATALOG
        ]
        docs_source = "error"

    recommendations = build_recommendations(
        signals=signals,
        inferred=inferred,
        citations=citations,
        docs_source=docs_source,
        module_id=module_id,
        from_version=from_version,
        to_version=to_version,
        repo_id=repo_id,
    )

    return {
        "status": "ok",
        "module_id": module_id,
        "repo_id": repo_id,
        "from_version": from_version,
        "to_version": to_version,
        "recommendations": recommendations,
        "approval_state": "awaiting_approval",
        "downtime_required": recommendations["downtime_required"],
        "requires_restart": recommendations["requires_restart"],
        "estimated_duration": recommendations["estimated_duration"],
        "upgrade_category": recommendations["upgrade_category"],
        "upgrade_paths": recommendations["upgrade_paths"],
        "prerequisites": recommendations["prerequisites"],
        "multi_az_plan": recommendations["multi_az_plan"],
        "alternatives": recommendations["alternatives"],
        "doc_citations": recommendations["doc_citations"],
        "docs_source": recommendations["docs_source"],
    }


def _cite_from_analysis(analysis: dict[str, Any], *keys: str) -> list[dict[str, Any]]:
    citations = (
        (analysis.get("recommendations") or {}).get("doc_citations")
        or analysis.get("doc_citations")
        or []
    )
    out: list[dict[str, Any]] = []
    for c in citations:
        if not keys or c.get("key") in keys or any(k in (c.get("url") or "") for k in keys):
            out.append(
                {
                    "title": c.get("title"),
                    "url": c.get("url"),
                    "snippet": (c.get("snippet") or "")[:240] or None,
                    "fetched": c.get("fetched"),
                }
            )
    # Dedup by url
    seen: set[str] = set()
    unique = []
    for c in out:
        u = c.get("url") or ""
        if u in seen:
            continue
        seen.add(u)
        unique.append(c)
    return unique[:4]


def _answer_release_chat(
    message: str,
    *,
    analysis: dict[str, Any],
    context: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Scoped engineer Q&A over Raise PR analysis (not a general chatbot)."""
    msg = (message or "").strip()
    lower = msg.lower()
    rec = analysis.get("recommendations") or analysis
    prereq = rec.get("prerequisites") or analysis.get("prerequisites") or {}
    paths = rec.get("upgrade_paths") or analysis.get("upgrade_paths") or []
    multi_az = rec.get("multi_az_plan") or analysis.get("multi_az_plan") or {}
    signals = rec.get("resource_signals") or {}
    ctx = context or {}
    module_id = analysis.get("module_id") or ctx.get("module_id") or "module"
    from_v = analysis.get("from_version") or ctx.get("from_version") or "?"
    to_v = analysis.get("to_version") or ctx.get("to_version") or "?"
    repo_id = analysis.get("repo_id") or ctx.get("repo_id") or "repo"

    citations: list[dict[str, Any]] = []
    answer = ""

    if not msg:
        return {
            "role": "assistant",
            "content": "Ask about this PR’s restart/downtime, Path A vs B, snapshot/AMI prereqs, Multi-AZ order, or the target resource impact.",
            "citations": [],
            "scoped": True,
        }

    # Guardrails: refuse off-topic
    off_topic_hints = ("weather", "joke", "write a poem", "who are you", "chatgpt", "general knowledge")
    if any(h in lower for h in off_topic_hints) and not any(
        k in lower for k in ("rds", "ec2", "ami", "snapshot", "upgrade", "pr", "restart", "downtime")
    ):
        return {
            "role": "assistant",
            "content": (
                "This chat is scoped to this Raise PR workbench (release bump, target resources, "
                "upgrade paths, and prerequisites). Ask about restart, Path A/B, snapshot/AMI, Multi-AZ, or impact."
            ),
            "citations": [],
            "scoped": True,
        }

    if any(k in lower for k in ("snapshot", "backup", "restore point")):
        answer = (
            f"**Snapshot prerequisite:** required=`{prereq.get('snapshot_required')}`, "
            f"status=`{prereq.get('snapshot_status')}`.\n\n"
            f"Evidence: {prereq.get('snapshot_evidence')}\n\n"
            "Before either Path A (in-place) or Path B (new instance + migrate), take/verify a SNAPSHOT. "
            "If status is unknown/fail, do not proceed until an engineer confirms the snapshot."
        )
        citations = _cite_from_analysis(analysis, "rds_snapshot", "rds_blue_green")

    elif any(k in lower for k in ("ami", "golden image", "oracle ami", "image_id")):
        answer = (
            f"**AMI prerequisite:** required=`{prereq.get('ami_required')}`, "
            f"status=`{prereq.get('ami_status')}`.\n\n"
            f"Evidence: {prereq.get('ami_evidence')}\n\n"
            "Where EC2/OS/Oracle AMI changes apply, confirm the target AMI exists and is approved before raise/merge."
        )
        citations = _cite_from_analysis(analysis, "ec2_ami", "ec2_replace_root")

    elif any(k in lower for k in ("prereq", "pre-req", "prerequisite", "checklist", "before proceed", "before we", "must i take", "must we take")):
        items = prereq.get("checklist") or []
        lines = ["Hard prerequisites checklist:\n"]
        for item in items:
            lines.append(
                f"- **{item.get('label')}**: required={item.get('required')}, "
                f"status=`{item.get('status')}` — {item.get('evidence')}"
            )
        if prereq.get("blocking"):
            lines.append(f"\nBlocking until confirmed: {', '.join(prereq['blocking'])}")
        # If they named a path, add a one-liner
        if "path a" in lower or "inplace" in lower or "in-place" in lower:
            lines.append("\nFor Path A (in-place): satisfy snapshot (and AMI if EC2) before apply; schedule restart/maintenance window.")
        if "path b" in lower or "new instance" in lower or "migrate" in lower:
            lines.append("\nFor Path B (new instance + migrate): snapshot + AMI gates still apply before cutover.")
        answer = "\n".join(lines)
        citations = _cite_from_analysis(analysis, "rds_snapshot", "ec2_ami")

    elif any(k in lower for k in ("path a", "path b", "in-place", "inplace", "blue/green", "blue green", "new instance", "migrate", "upgrade path")):
        lines = [f"Upgrade paths for `{module_id}` `{from_v}` → `{to_v}` on `{repo_id}`:\n"]
        for p in paths:
            mark = "★ recommended" if p.get("recommended") else "alternative"
            lines.append(
                f"- **{p.get('name')}** ({mark}): restart={p.get('requires_restart')}, "
                f"downtime={p.get('requires_downtime')}. {p.get('summary')}"
            )
            if p.get("when_to_use"):
                lines.append(f"  When: {p['when_to_use']}")
        answer = "\n".join(lines)
        citations = _cite_from_analysis(analysis, "rds_blue_green", "rds_upgrade", "ec2_ami")

    elif any(k in lower for k in ("restart", "reboot", "downtime", "outage", "maintenance window")):
        answer = (
            f"**Restart required:** `{rec.get('requires_restart', analysis.get('requires_restart'))}`\n"
            f"**Downtime required:** `{rec.get('downtime_required', analysis.get('downtime_required'))}`\n"
            f"**Estimated duration:** {rec.get('estimated_duration') or analysis.get('estimated_duration')}\n\n"
            f"Category: {rec.get('upgrade_category') or analysis.get('upgrade_category')}\n"
            "Schedule a maintenance window when restart/downtime is yes; Multi-AZ shortens perceived outage via failover."
        )
        citations = _cite_from_analysis(analysis, "rds_maintenance", "rds_upgrade", "rds_multiaz")

    elif any(k in lower for k in ("multi-az", "multiaz", "multi az", "standby", "secondary", "failover")):
        if multi_az:
            order = multi_az.get("order") or []
            answer = f"**Multi-AZ plan:** {multi_az.get('summary')}\n"
            if order:
                answer += "\nOrder:\n" + "\n".join(f"{i+1}. {s}" for i, s in enumerate(order))
        else:
            answer = "No Multi-AZ plan object on this analysis — treat as Single-AZ unless graph shows otherwise."
        citations = _cite_from_analysis(analysis, "rds_multiaz", "rds_upgrade")

    elif any(k in lower for k in ("resource", "rds", "ec2", "impact", "target", "affected", "how will")):
        types = signals.get("resource_types") or []
        addrs = signals.get("resource_addresses") or []
        answer = (
            f"Target repo `{repo_id}` bumping `{module_id}` `{from_v}` → `{to_v}`.\n"
            f"Detected resource types: {', '.join(types) if types else 'none in graph sample'}.\n"
            f"Sample addresses: {', '.join(addrs[:8]) if addrs else 'not found in graph'}.\n"
            f"Engines/versions: {signals.get('engine_versions')}; AMIs: {signals.get('amis')}.\n\n"
            f"Impact: restart={rec.get('requires_restart')}, downtime={rec.get('downtime_required')}, "
            f"recommended path=`{rec.get('recommended_path_id')}`.\n"
            f"Prereqs blocking: {prereq.get('blocking') or 'none listed'}."
        )
        citations = _cite_from_analysis(analysis, "rds_upgrade", "ec2_ami")

    else:
        # Default: concise workbench brief
        rec_path = next((p for p in paths if p.get("recommended")), None)
        answer = (
            f"This PR: `{repo_id}` / `{module_id}` `{from_v}` → `{to_v}`.\n"
            f"Restart: {rec.get('requires_restart')}; downtime: {rec.get('downtime_required')} "
            f"({rec.get('estimated_duration')}).\n"
            f"Recommended: {rec_path.get('name') if rec_path else 'n/a'}.\n"
            f"Snapshot: {prereq.get('snapshot_status')} (required={prereq.get('snapshot_required')}); "
            f"AMI: {prereq.get('ami_status')} (required={prereq.get('ami_required')}).\n\n"
            "Ask specifically about Path A/B, snapshot, AMI, Multi-AZ order, restart, or target resource impact."
        )
        citations = _cite_from_analysis(analysis)[:2]

    return {
        "role": "assistant",
        "content": answer,
        "citations": citations,
        "scoped": True,
    }


async def chat_release_compare(body: dict[str, Any]) -> dict[str, Any]:
    """Answer a scoped engineer question using analysis + optional doc snippets."""
    message = body.get("message") or body.get("content") or ""
    analysis = body.get("analysis") or {}
    context = body.get("context") or {}
    history = body.get("history") or body.get("messages") or []

    # If analysis empty but context has enough to re-analyze lightly — use context signals only
    if not analysis and context.get("module_id"):
        analysis = {
            "module_id": context.get("module_id"),
            "repo_id": context.get("repo_id"),
            "from_version": context.get("from_version"),
            "to_version": context.get("to_version"),
            "recommendations": context.get("recommendations") or {},
            "doc_citations": context.get("doc_citations") or [],
        }

    # Optionally refresh a couple of doc snippets if client sent keys and none cached
    doc_keys = body.get("doc_keys") or []
    extra_citations: list[dict[str, Any]] = []
    if doc_keys and not (analysis.get("doc_citations") or (analysis.get("recommendations") or {}).get("doc_citations")):
        try:
            extra_citations, _ = await fetch_aws_docs(doc_keys[:3], timeout=5.0)
            if extra_citations:
                analysis = {
                    **analysis,
                    "doc_citations": [
                        {
                            "title": c["title"],
                            "url": c["url"],
                            "fetched": c.get("fetched", False),
                            "snippet": c.get("snippet"),
                            "key": c.get("key"),
                        }
                        for c in extra_citations
                    ],
                }
        except Exception:  # noqa: BLE001
            pass

    reply = _answer_release_chat(message, analysis=analysis, context=context)

    # Include last user turn echo for persistence convenience
    return {
        "status": "ok",
        "message": {"role": "user", "content": message},
        "reply": reply,
        "history_len": len(history) + 2 if message else len(history),
    }
