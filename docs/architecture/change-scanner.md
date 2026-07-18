# InfraGraph Change Scanner (IGCS)

World-class **git change → IaC knowledge graph** scanning. Not AppSec SAST; not Terraform apply orchestration.

## Market ranking (summary)

| Rank | Emulate | Why |
|------|---------|-----|
| S1 | Sourcegraph (webhook + mirror + reconcile) | Correct git freshness |
| S2 | Meta Infer / Semgrep diff-aware | Diff + dependents, not full rescan |
| S3 | Spacelift event→workspace routing | Route events to interested stacks |
| S4 | **InfraGraph Neo4j blast radius** | Differentiator |
| S5 | Checkov/Trivy | Optional policy plugins |

Neighbors (Spacelift, HCP Terraform, Atlantis) do plan/apply/drift. They do **not** own org-wide module→consumer graph + FinOps/CAB from the same scan.

## Design principles

1. Webhook-first, reconcile-second  
2. Diff-aware parse + dependent file closure  
3. Subscription gate before clone  
4. SHA watermark per repo  
5. Idempotent graph upsert for touched subgraphs  
6. Job types: `incremental_scan` | `full_scan` | `reconcile_scan` | `mandatory_impact_analysis` | `module_impact_hint`

## Pipeline

```
GitHub webhook (HMAC)
  → resolve github_full_name → subscription.id
  → coalesce push per repo
  → acquire (remote git clone/fetch → ephemeral data/mirrors cache; local_path demo-only)
  → if incremental: git diff last_sha..head + path filters + dependent closure
  → parse (filtered or full)
  → enrich → Postgres → Neo4j
  → watermark last_scanned_sha
  → if module interface changed → module_impact_hint
Nightly reconcile_scan → full_scan (correctness)
Release tag → mandatory_impact_analysis (+ release notes body)
```

## Subscription model (remote-first)

**Subscribe = scan rights on a remote repo identity** (`github_full_name`), not copying source into a product tree.

| Concern | Behavior |
|---------|----------|
| Acquire | Remote clone/fetch first into `data/mirrors/<repo_id>` (ephemeral worker cache) |
| Public GitHub | HTTPS clone allowed by default (`IGCS_ALLOW_PUBLIC_CLONE=false` to disable) |
| Private / GHE | `GITHUB_TOKEN` or `GH_TOKEN`; optional `GITHUB_HOST` |
| Offline demo | `local_path` only when `IGCS_FORCE_LOCAL=true` or no remote URL |
| Release tags | Webhook `release.body` → `impact_report.release_notes`; API fetch if empty + token |

## Job payload contract

```json
{
  "id": "job-…",
  "type": "incremental_scan",
  "priority": "P2",
  "repo_id": "upstream-core-network-modules",
  "payload": {
    "trigger": "webhook_push|manual|reconcile|subscribe",
    "head_sha": "abc123",
    "before_sha": "def456",
    "delivery_id": "github-delivery-uuid",
    "ref": "refs/heads/main",
    "coalesced": true
  }
}
```

## Scan contract (audit)

Every successful scan records on `subscriptions` and in `scan_runs.details`:

- `mode`: full | incremental | reconcile  
- `from_sha`, `to_sha`  
- `files_touched[]`  
- `parse_ms`, `graph_ms`  

## Success metrics

| Metric | Target |
|--------|--------|
| Push→graph | &lt; 2 min typical |
| Incremental vs full CPU | 5–20× less on small diffs |
| Unsubscribed repos | never acquired |
| Nightly reconcile | heals silent drift |

## Related code

- Worker: `apps/worker/internal/stages/acquisition`, `delta`, `pipeline/runner.go`, `stages/impact` (contract diffs + locations)
- API: `apps/api/src/webhooks`, `scheduler`, `scanner`, `impact`
- UI: `/scanner` Scanner Monitor; Release Tag + Dependency Tree impact overlay + AI chat
- Schema: `config/postgres/schema.sql` (`last_scanned_sha`, `webhook_deliveries`, `impact_report`, `locations`)

## Scanner Monitor + schedules

- Input gate: **subscribed repos only** (adhoc, reconcile, release-tag impact).
- Regular schedule: `scan-profiles.json` → `full_reconcile_cron`; optional per-repo `triggers_enabled.reconcile_enabled` (default true).
- Adhoc: Subscriptions **Adhoc scan** → `full_scan` P1 `trigger=adhoc_ui`.
- Release tag: webhook / manual → `mandatory_impact_analysis` → rich `change_plans.impact_report` (contract diff, **release_notes**, locations).
- EOL/FinOps crons: configured for future; not enforced in this slice.
