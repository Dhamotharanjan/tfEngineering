# Impact Loop — Product & Architecture Memory

Durable record of the decisions behind `platform/`. This is the "why" that the
code and README do not fully capture. Keep it updated as decisions change.

## Product thesis

InfraGraph sits on the **producer PR and release tag**: when a shared
Terraform/Terragrunt module changes, it names every downstream consumer (repo,
file, line) that is affected and classifies how badly it breaks — then keeps the
developer in their existing Git workflow while pulling the organisation into a
durable Release Analysis.

Positioning: *Renovate/Dependabot bump pins after publish. Spacelift/TFC plan the
stack that changed. We sit on the module PR and tag: contract diff → every
consumer across repos → fail the merge if breaking → open the fix.*

## Product doctrine

**Must**
1. Live in PR / tag / (later) pre-apply — natural fit, no new daily tool.
2. Classify each impacted consumer: BREAKING | NON_BREAKING | UNKNOWN.
3. Name who is impacted and notify them.
4. Notify architects when a change disturbs a stamped pattern.
5. Deep work happens in-product (Release Analysis); PR is the tripwire.
6. One engine; dials for size (WARN → BLOCK → approvers → apply gate).

**Must not**
1. Rebuild the graph on every PR.
2. Spam comments when nothing IaC-relevant changed.
3. Block on vibes — AI explains evidence, it does not decide the class.
4. Make the portal mandatory for every commit.
5. Hardcode any repo/org/module/version/owner data.

## Architecture: three paths, one engine

- **COLD** — subscribe / full scan / reconcile → parse → WRITE Postgres + Neo4j → set `indexed_sha`.
- **WARM** — push to default branch → incremental parse → WRITE graph → advance `indexed_sha`.
- **HOT** — pull_request / tag-release / pre-apply → READ ONLY. Never writes the
  graph. Never advances `indexed_sha`. Writes only impact reports.

Dual watermark: `indexed_sha` (graph truth, COLD/WARM only) vs `last_event_sha`
(informational, HOT). Stale graph or missing contract → UNKNOWN + async WARM
refresh; never rebuild inline.

## AI boundary

Deterministic engines decide the facts (contract diff, consumer inputs, policy).
AI is narration only, grounded strictly in evidence, and must return UNKNOWN when
evidence is absent. No fake hash "embeddings"; fingerprints are real SHA-256.

## IP / business stance

- The broad idea is not patentable; a specific method might be, but it is optional
  early. Defensibility comes from execution depth, outcome data (landed upgrades),
  switching cost (pattern stamps in the audit cycle), and distribution — not a filing.
- Monetize on upstream modules under management / protected repos / landed
  upgrades — not editor seats or repos scanned.

## Build order

Phase 0 (route PR off graph-writing scan) → Phase 1 (dual watermark) →
Phase 2 (HOT impact engine) → Phase 3 (Git check + comment + notify) →
Phase 4 (pattern disturb + Release Analysis) → Phase 5 (auth + audited override) →
Phase 6 (pre-apply gate, later).

## Status

`platform/` is a tested reference implementation (32/32 tests green).

**Phase 0 wiring (live API):** see [PHASE0_WIRING.md](./PHASE0_WIRING.md).
Webhook PRs no longer enqueue `incremental_scan`; they run HOT inline via
`ImpactLoop`. Push (default branch) still enqueues WARM `incremental_scan`.
Release/tag webhooks run HOT `tag_impact_query` inline.
