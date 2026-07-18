# InfraGraph — Stakeholder pitch brief

**InfraGraph · Change Intelligence** turns existing Terraform / Terragrunt (and related IaaC) into organization knowledge so change is **fast**, **governed**, and **safe**.

This brief mirrors the in-app pitch at `/pitch`. Open the prototype (default: `http://localhost:3000`) and use the screen links below to walk each core idea.

---

## The four core ideas (do not dilute)

1. Existing infrastructure code → org knowledge → quick turnaround  
2. Org-wide IaaC for Security, FinOps, and internal/external architect forums  
3. Accept upstream change—and ripple safely to downstream apps  
4. Subscription model—interested teams opt in and gain concrete benefits  

In-app spine: [http://localhost:3000/pitch](http://localhost:3000/pitch)

---

## 1. Existing infrastructure code → knowledge → quick turnaround

**Idea:** Use what you already run. Stop rediscovering dependencies by hand. Build shared knowledge so the organization can turn changes around quickly.

**How InfraGraph addresses it**
- Continuously scan subscribed repos into a living knowledge graph (modules, stacks, cloud resources).
- Classify reusable **patterns (Layer 1)** and **application topology (Layer 2)** on one map.
- Expose dependency hierarchy and module interface diffs so upgrade paths are clear before work starts.
- Orient faster: know what exists, who owns it, and what to touch—before the first PR.

**What you’ll see**  
Pattern catalog with stamp-ready architecture canvas; application-scoped graphs; release/module compare workbench.

| Screen | URL |
|--------|-----|
| Infra Graph · Patterns | [http://localhost:3000/graph/infra?tab=patterns](http://localhost:3000/graph/infra?tab=patterns) |
| Dependency Tree | [http://localhost:3000/dependencies](http://localhost:3000/dependencies) |
| Release Compare | [http://localhost:3000/release-compare](http://localhost:3000/release-compare) |

---

## 2. Org-wide IaaC — Security, FinOps, architect & auditor forums

**Idea:** Manage the entire organization’s IaaC in one operating picture—ready for security, cost stewardship, and internal or external architecture / auditor forums.

**How InfraGraph addresses it**
- Architect, FinOps, and Risk panels on patterns; compliance stamps (e.g. SOC2) for external auditors.
- FinOps attribution: module → account → service spend, plus extended-support and waste signals.
- Observability and EOL keep patch posture and technical-debt tax visible to leadership.
- CAB reports and audit trail give change advisory boards and auditors exportable evidence.

**What you’ll see**  
Stamp a pattern architecture; then cost, EOL, CAB export, and audit in the same portal.

| Screen | URL |
|--------|-----|
| Patterns · Stamp & forums | [http://localhost:3000/graph/infra?tab=patterns](http://localhost:3000/graph/infra?tab=patterns) |
| FinOps & Cost | [http://localhost:3000/finops](http://localhost:3000/finops) |
| Observability | [http://localhost:3000/observability](http://localhost:3000/observability) |
| EOL & Extended Support | [http://localhost:3000/eol](http://localhost:3000/eol) |
| CAB Reports | [http://localhost:3000/reports](http://localhost:3000/reports) |
| Audit Log | [http://localhost:3000/audit](http://localhost:3000/audit) |

---

## 3. Upstream change → safe downstream ripple

**Idea:** Be prepared to accept change from upstream modules/tags and apply it so impact ripples cleanly to downstream applications.

**How InfraGraph addresses it**
- Blast radius maps upstream publishers to every downstream consumer, stack, and resource slice.
- Mandatory release-tag impact analysis shows who must act when versions merge.
- Guided change plans and per-consumer rollout (canary, gates, rollback) turn impact into an executable path.
- Teams stop guessing blast radius—and apply upstream change with a controlled downstream ripple.

**What you’ll see**  
Upstream/downstream graph for a module; release-tag impact; phased change and rollout plans.

| Screen | URL |
|--------|-----|
| Blast Radius | [http://localhost:3000/impact/modules-vpc](http://localhost:3000/impact/modules-vpc) |
| Release Tag Impact | [http://localhost:3000/releases/v3.0.0](http://localhost:3000/releases/v3.0.0) |
| Change Plan | [http://localhost:3000/plans/change](http://localhost:3000/plans/change) |
| Rollout Plan | [http://localhost:3000/plans/rollout](http://localhost:3000/plans/rollout) |

---

## 4. Subscription model — benefits for participating teams

**Idea:** Coverage is entitlement-based. Teams that want the value subscribe their repos into the org graph and participate without owning the whole platform.

**How InfraGraph addresses it**
- Opt-in subscriptions decide which repos seed the shared knowledge graph.
- Roles (module source vs downstream consumer) and tiers clarify how each team participates.
- Sync and scan bring subscribed repos into lineage, patterns, and impact pipelines.
- Unsubscribed work stays out of the graph until a team chooses to join.

**What you’ll see**  
Repo list with roles, tiers, scan status, and links into blast radius; Dashboard shows subscribed coverage KPI.

| Screen | URL |
|--------|-----|
| Repo Subscriptions | [http://localhost:3000/repos](http://localhost:3000/repos) |
| Executive Dashboard | [http://localhost:3000/](http://localhost:3000/) |

### Benefits for subscribed teams

- Inclusion in the org knowledge and infra pattern graph  
- Blast-radius and upstream/downstream lineage for your repos  
- Release-tag and module upgrade impact before merge  
- Guided change and rollout plans for downstream consumers  
- FinOps and EOL visibility attributed to your stacks  
- CAB- and audit-ready exports for change forums  
- Scan/sync into the shared graph without owning the whole platform  

---

## Recommended demo path

Walk the four ideas in order:

1. [Subscribe repos](http://localhost:3000/repos) — opt in coverage  
2. [Infra Graph](http://localhost:3000/graph/infra?tab=patterns) — knowledge & architecture  
3. [Blast Radius](http://localhost:3000/impact/modules-vpc) — upstream → downstream  
4. [Release Compare](http://localhost:3000/release-compare) — upgrade path  
5. [Change Plan](http://localhost:3000/plans/change) / [Rollout Plan](http://localhost:3000/plans/rollout) — apply the ripple  
6. [FinOps](http://localhost:3000/finops) / [CAB Reports](http://localhost:3000/reports) — cost & forums  

Same path is linked from the portal: [Why InfraGraph](http://localhost:3000/pitch).

---

## AI + Milvus — used wisely today, enhanced tomorrow

**Principle:** Vectors assist; rules protect accuracy. Graph (Neo4j) + Postgres stay the source of truth for lineage, cost, and CAB evidence. Milvus is a similarity index—not the authority for security or HA topology. AI chat is scoped to release/PR context so it cannot invent blast radius.

### Where we use it today

| Capability | Where | How |
|------------|--------|-----|
| Interaction signatures | Layer-1 Infra Graph / AI service | Exhaustive edges (IN_VPC, USES_SG, CIDR, ports, HA) → Milvus `infra_interactions` |
| Pattern templates | Pattern derive | Canonical vectors in `infra_patterns` |
| Hybrid pattern match | `POST …/patterns/derive` | **Rules first** (family / HA / ports); vectors confirm or fill gaps only |
| IaC chunk similarity | Fleet / similar-repo | Collection `iac_patterns` |
| Upgrade analysis | Release Compare workbench | `POST /release-compare/analyze` — paths, restart/downtime, doc-aware notes |
| Engineer chat | Raise PR panel | `POST /release-compare/chat` — scoped to the PR request |

### Future enhancements

- Richer embeddings (production model) for cross-org pattern search and duplicate-module detection  
- Vector-assisted blast-radius ranking (“most similar past upgrades / incidents”)  
- Milvus-backed RAG over AWS/module docs inside Release Compare chat  
- Natural-language ask across subscribed estate (“which apps still pin vpc &lt; v3?”)  
- Automated remediation PRs grounded in graph + stamped patterns  
- Continuous CVE/policy retrieval ranked by business blast radius  

### WhatsApp flyer (actual screens)

Share pack (6 PNGs, phone portrait):

`docs/marketing/flyer/whatsapp/infragraph-whatsapp-01.png` … `-06.png`

Includes: Blast Radius, Pattern Layer 1, Layer 2 component dependency, Dependency Tree, Infra Graph, Release Tag Impact, Release Compare AI workbench, FinOps, Subscriptions, and the AI/Milvus story (page 6).

Regenerate:

```powershell
cd docs/marketing
node capture-screens.mjs
node render-whatsapp-flyer.mjs
```

