# Optional policy plugins (Phase 5 add-ons)

IGCS core is **graph change intelligence**, not AppSec. Optional sidecars (not wired by default):

| Plugin | Role | When to enable |
|--------|------|----------------|
| Checkov / KICS | IaC misconfig rules | After parse, attach findings to Neo4j `HAS_FINDING` |
| Trivy | FS vulns / secrets | Nightly reconcile only |
| Semgrep | Custom org rules | PR incremental path |
| TruffleHog | History secrets | Onboard / full scan |

Invocation pattern (future): worker job `policy_scan` with `{repo_id, mode, files[]}` after successful incremental/full parse. Do **not** block graph write on policy failures.
