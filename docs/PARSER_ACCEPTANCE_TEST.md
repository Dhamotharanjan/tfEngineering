# HCL Parser â€” Acceptance Test Checklist

End-to-end acceptance checklist for the industry-grade HCL parser MVP. Connects unit tests, public test repositories, subscription sync, scan pipeline, and API verification.

**Related configuration:**

- Public repo catalog: [`config/public-test-repos.json`](../config/public-test-repos.json)
- Clone instructions and per-repo parser features: [`mvp_demo/public_repos/README.md`](../mvp_demo/public_repos/README.md)
- Subscription registry: [`config/repo-subscriptions.json`](../config/repo-subscriptions.json)

---

## Prerequisites

| Requirement | Command / location |
|---|---|
| Docker stack running | `docker compose up -d --build` (from repo root) |
| API reachable | `http://localhost:8000/api/health` |
| Clone helper (optional) | `.\scripts\clone-public-test-repos.ps1` or `./scripts/clone-public-test-repos.sh` |
| Docker (unit tests) | ``.\scripts\run-parser-tests.ps1`` or ``./scripts/run-parser-tests.sh`` — no local Go install |

---

## Step 1 — Go parser unit tests

**Primary on Windows** (no local Go install; requires Docker). From repository root:

```powershell
.\scripts\run-parser-tests.ps1
```

**Linux / macOS:**

```bash
./scripts/run-parser-tests.sh
```

Both scripts build the worker compile stage and run parser tests in the container:

```bash
docker build --target build -t infragraph-worker-test ./apps/worker
docker run --rm infragraph-worker-test go test ./internal/stages/parse/... -v
```

**Optional (local Go toolchain):** from `apps/worker`:

```bash
cd apps/worker
go test ./internal/stages/parse/... -v
```

**Expected:** All tests pass (6 test functions, 0 failures).

| Test | Fixture | Validates |
|---|---|---|
| `TestParseNestedSecurityGroup` | `testdata/nested_security_group.tf` | Nested `ingress`/`egress`, tags, references |
| `TestParseTerragruntFull` | `testdata/terragrunt_full.hcl` | Include, dependency, mock_outputs, generate, input redaction |
| `TestParseModuleWithForEach` | `testdata/module_with_foreach.tf` | `for_each` on modules and resources |
| `TestParseRemoteState` | `testdata/remote_state.tf` | `terraform_remote_state` data source, S3 backend config |
| `TestParseComplexConsumer` | `testdata/complex_consumer.tf` | Modules, variables, outputs, providers, parsed block inventory |
| `TestRedactionDenylist` | inline fixture | Scan-profile `attribute_denylist` redacts secrets |

**Parser source files** (under `apps/worker/internal/stages/parse/`):

- `extract.go` â€” block extraction and attribute walking
- `terraform.go` â€” `.tf` / `.tf.json` parsing
- `terragrunt.go` â€” `terragrunt.hcl` parsing
- `hcl.go` â€” `ParseRepoWithProfile` entry point
- `hcl_test.go` â€” regression tests
- `testdata/` â€” synthetic fixtures listed above

Scan profile loading: `apps/worker/internal/config/scan_profile.go` (profile ID `enterprise-aws-default` from `config/scan-profiles.json`).

**Schema tables** (in `config/postgres/schema.sql`): `parsed_blocks`, `data_sources`, `variables`, `outputs`, `provider_configs`, `remote_state_refs`.

---

## Step 2 â€” Clone recommended public repos

Minimum set for parser acceptance (nested HCL + Terragrunt + module blast radius):

```bash
# From repository root
git clone --depth 1 --branch master \
  https://github.com/terraform-aws-modules/terraform-aws-security-group.git \
  mvp_demo/public_repos/public-tfm-security-group

git clone --depth 1 --branch master \
  https://github.com/terraform-aws-modules/terraform-aws-vpc.git \
  mvp_demo/public_repos/public-tfm-vpc

git clone --depth 1 --branch main \
  https://github.com/gruntwork-io/terragrunt-infrastructure-live-example.git \
  mvp_demo/public_repos/public-gruntwork-live

git clone --depth 1 --branch master \
  https://github.com/gruntwork-io/terragrunt-infrastructure-modules-example.git \
  mvp_demo/public_repos/public-gruntwork-modules
```

Or clone all curated repos:

```powershell
.\scripts\clone-public-test-repos.ps1
```

---

## Step 3 â€” Enable subscriptions, sync, and scan

1. **Enable subscriptions** â€” In [`config/repo-subscriptions.json`](../config/repo-subscriptions.json), set `"subscribed": true` for each cloned repo ID. Confirm `local_path` matches the clone destination (e.g. `mvp_demo/public_repos/public-tfm-vpc`).

2. **Sync subscriptions into Postgres:**

   ```bash
   curl -X POST http://localhost:8000/api/subscriptions/sync
   ```

3. **Trigger full scan** (per repo):

   ```bash
   curl -X POST http://localhost:8000/api/subscriptions/public-tfm-security-group/scan
   curl -X POST http://localhost:8000/api/subscriptions/public-tfm-vpc/scan
   curl -X POST http://localhost:8000/api/subscriptions/public-gruntwork-live/scan
   curl -X POST http://localhost:8000/api/subscriptions/public-gruntwork-modules/scan
   ```

4. **Wait for completion** â€” Poll job status or subscription list until `last_scan_status` is `completed` and `graph_node_count` > 0:

   ```bash
   curl http://localhost:8000/api/subscriptions
   curl "http://localhost:8000/api/jobs?limit=10"
   ```

---

## Step 4 â€” Verify API endpoints

Base URL: `http://localhost:8000/api`

| Endpoint | Purpose | Pass criteria |
|---|---|---|
| `GET /subscriptions/{repoId}/parsed-blocks` | Raw parsed HCL blocks | `count` > 0; `block_type` includes `resource`, `module`, and/or `terragrunt` blocks as appropriate |
| `GET /subscriptions/{repoId}/parsed-blocks?type=resource` | Filter by block type | Security-group repo returns `aws_security_group` blocks with `nested_blocks.ingress` or `nested_blocks.egress` |
| `GET /subscriptions/{repoId}/variables` | Variable declarations | VPC repo: dozens of variables; sensitive flags preserved where declared |
| `GET /subscriptions/{repoId}/dependencies` | Resource, stack, and module refs | `module_references` populated for Terragrunt repos; `stack_dependencies` for `dependency` blocks |
| `GET /subscriptions/{repoId}/resources` | Normalized resources | Security-group: `aws_security_group` resources with nested rule metadata |
| `GET /blast-radius/{moduleId}/graph?repoId={repoId}&slice=component` | Neo4j blast-radius graph | `graph.nodes` and `graph.edges` non-empty after scan; `store_status` = `ok` |

**Example checks:**

```bash
# Parsed blocks (nested ingress)
curl "http://localhost:8000/api/subscriptions/public-tfm-security-group/parsed-blocks?type=resource"

# Variables contract
curl "http://localhost:8000/api/subscriptions/public-tfm-vpc/variables"

# Terragrunt module sources and stack deps
curl "http://localhost:8000/api/subscriptions/public-gruntwork-live/dependencies"

# Blast-radius graph for a known module source
curl "http://localhost:8000/api/blast-radius/terraform-aws-modules/terraform-aws-security-group/aws/graph?repoId=public-tfm-security-group&slice=component&depth=3"
```

---

## Step 5 â€” Per-repo expected outcomes

| Repo ID | Key parser features | Expected API / graph outcomes |
|---|---|---|
| `public-tfm-security-group` | Dynamic `ingress`/`egress`, rule submodule, multi-file layout | `parsed-blocks` with `nested_blocks.ingress` / `nested_blocks.egress`; `aws_security_group` resources; submodule `module` blocks under `modules/` paths |
| `public-tfm-vpc` | `data` sources, nested subnet/NAT/route resources, variables/outputs | High `variables` count; `data_sources` for `aws_availability_zones` etc.; resource dependency edges between subnet â†” route table â†” NAT |
| `public-gruntwork-live` | `include`, `dependency`, `mock_outputs`, `inputs`, `locals` | `stack_dependencies` rows for `../network`-style paths; `module_references` with `git::` sources and `ref=` pins pointing at gruntwork modules |
| `public-gruntwork-modules` | Resource/variable/output/provider blocks | Parsed `resource`, `variable`, `output`, `provider` blocks; upstream lineage edges from `public-gruntwork-live` after both repos scanned |
| `public-tfm-eks` (optional) | Nested submodules, provider aliases, `depends_on` | Deep module tree in graph; EKS version attributes available for EOL signals |
| `public-binbash-live` (optional) | Multi-account Terragrunt, registry module sources | Cross-repo `module_references` to `terraform-aws-modules/*`; dependency chains across account folders |

### Feature â†’ verification mapping

| Parser capability | Where to verify |
|---|---|
| Nested ingress/egress | `public-tfm-security-group` â†’ `/parsed-blocks?type=resource` |
| `for_each` on modules/resources | Unit test `TestParseModuleWithForEach`; live repos with `count`/`for_each` in VPC/EKS |
| Terragrunt `dependency` / `mock_outputs` | `public-gruntwork-live` â†’ `/dependencies` â†’ `stack_dependencies` |
| Remote state (`terraform_remote_state`) | Unit test `TestParseRemoteState`; Cloud Posse / Binbash live repos in full matrix |
| Variable sensitivity + redaction | Unit tests `TestParseComplexConsumer`, `TestRedactionDenylist`; Terragrunt `inputs` redaction on gruntwork-live |
| Provider blocks | `provider_configs` table populated; `/parsed-blocks?type=provider` where exposed |

---

## Reset between test runs

Use the admin reset endpoint to clear scan artifacts, graph data, and parser tables:

```bash
curl -X POST http://localhost:8000/api/admin/reset \
  -H "Content-Type: application/json" \
  -d '{"confirm":"reset"}'
```

This truncates `parsed_blocks`, `data_sources`, `variables`, `outputs`, `provider_configs`, and `remote_state_refs` along with scan runs and jobs.

---

## Sign-off checklist

- [ ] Step 1: ``.\scripts\run-parser-tests.ps1`` — all tests pass
- [ ] Step 2: Minimum three repos cloned (`public-tfm-security-group`, `public-tfm-vpc`, `public-gruntwork-live` + modules)
- [ ] Step 3: Subscriptions synced; scans complete with `last_scan_status: completed`
- [ ] Step 4: All API endpoints return non-empty, structurally valid JSON
- [ ] Step 5: Per-repo outcomes match the table above
- [ ] Admin reset clears parser tables (re-scan produces fresh `created_at` timestamps)


