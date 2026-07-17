# Public Terraform / Terragrunt Test Repositories

Curated upstream public GitHub repositories for **InfraGraph parser regression** and **blast-radius graph validation**. These complement the synthetic fixtures under `mvp_demo/sample_repos/` with real-world HCL complexity.

Configuration catalog: [`config/public-test-repos.json`](../../config/public-test-repos.json)

## Quick start

1. Clone the repos you need (see commands below, or run the helper script).
2. Flip `subscribed: true` in [`config/repo-subscriptions.json`](../../config/repo-subscriptions.json) for the repos you cloned.
3. Restart the worker / re-sync subscriptions so scans pick up the new `local_path` entries.

### Clone all repos (PowerShell)

```powershell
.\scripts\clone-public-test-repos.ps1
```

### Clone all repos (Bash)

```bash
./scripts/clone-public-test-repos.sh
```

---

## Individual clone commands

Run from the repository root (`tfEngineering/`). Each command performs a shallow clone into `mvp_demo/public_repos/{id}/`.

### 1. public-gruntwork-live — Terragrunt live layout

```bash
git clone --depth 1 --branch main \
  https://github.com/gruntwork-io/terragrunt-infrastructure-live-example.git \
  mvp_demo/public_repos/public-gruntwork-live
```

| Parser features | Expected blast radius |
|---|---|
| `include`, `find_in_parent_folders`, `dependency`, `mock_outputs`, `inputs`, `locals` | Changes in `public-gruntwork-modules` propagate to all env folders (qa/stage/prod) that reference the git module source; dependency edges link ASG ↔ MySQL stacks within each account/region. |

### 2. public-gruntwork-modules — Upstream modules for Gruntwork live

```bash
git clone --depth 1 --branch master \
  https://github.com/gruntwork-io/terragrunt-infrastructure-modules-example.git \
  mvp_demo/public_repos/public-gruntwork-modules
```

| Parser features | Expected blast radius |
|---|---|
| `resource`, `variable`, `output`, `provider` blocks; multi-file layout | Tag/release on this repo should surface downstream impact on `public-gruntwork-live` terragrunt units that pin `ref=` in `terraform.source`. |

### 3. public-tfm-vpc — terraform-aws-modules VPC

```bash
git clone --depth 1 --branch master \
  https://github.com/terraform-aws-modules/terraform-aws-vpc.git \
  mvp_demo/public_repos/public-tfm-vpc
```

| Parser features | Expected blast radius |
|---|---|
| `data` sources, nested subnet/route/NAT resources, `variable`/`output` contracts | Version bump affects any consumer referencing `terraform-aws-modules/vpc/aws`; internal resource changes (e.g. `aws_subnet`) ripple to dependent route table and NAT gateway nodes. |

### 4. public-tfm-security-group — Nested ingress/egress blocks

```bash
git clone --depth 1 --branch master \
  https://github.com/terraform-aws-modules/terraform-aws-security-group.git \
  mvp_demo/public_repos/public-tfm-security-group
```

| Parser features | Expected blast radius |
|---|---|
| Dynamic `ingress`/`egress` blocks, rule submodule, CIDR/port attributes | Security rule attribute changes flag `sg_open_to_world` scan signals; submodule `modules/` references create nested module nodes in the graph. |

### 5. public-tfm-eks — Complex EKS module tree

```bash
git clone --depth 1 --branch master \
  https://github.com/terraform-aws-modules/terraform-aws-eks.git \
  mvp_demo/public_repos/public-tfm-eks
```

| Parser features | Expected blast radius |
|---|---|
| Nested submodules, provider aliases, `depends_on`, EKS version attributes | Submodule version changes (node groups, IRSA, addons) expand blast radius across the full EKS module tree; EKS `version` changes trigger EOL tracking signals. |

### 6. public-cloudposse-components — Cloud Posse component catalog

```bash
git clone --depth 1 --branch main \
  https://github.com/cloudposse/terraform-aws-components.git \
  mvp_demo/public_repos/public-cloudposse-components
```

| Parser features | Expected blast radius |
|---|---|
| Per-stack `terragrunt.hcl`, `include`, `dependency`, `generate`, cross-component refs | Component-layer changes (e.g. `vpc`, `eks`) cascade to dependent stacks via terragrunt dependency outputs; large graph stress test. |

> **Note:** This repo is large (~hundreds of MB). Clone only when running full-scale parser benchmarks.

### 7. public-binbash-live — Binbash Leverage live AWS infra

```bash
git clone --depth 1 --branch master \
  https://github.com/binbashar/le-tf-infra-aws.git \
  mvp_demo/public_repos/public-binbash-live
```

| Parser features | Expected blast radius |
|---|---|
| Multi-account terragrunt, `dependency`/`mock_outputs`, registry module sources | Mirrors enterprise customer topology; module upgrades to `terraform-aws-modules/*` show cross-repo blast radius into account/region/env layers. |

### 8. public-gcp-fabric — GCP Cloud Foundation Fabric

```bash
git clone --depth 1 --branch master \
  https://github.com/GoogleCloudPlatform/cloud-foundation-fabric.git \
  mvp_demo/public_repos/public-gcp-fabric
```

| Parser features | Expected blast radius |
|---|---|
| GCP `provider` blocks, multi-file modules under `modules/`, blueprint cross-refs | Validates non-AWS provider parsing; blueprint composition changes propagate through shared networking/IAM module outputs. |

> **Note:** Large monorepo. Consider sparse checkout or clone only `modules/` for lightweight parser smoke tests.

---

## Recommended test matrix

| Goal | Minimum repos to clone |
|---|---|
| Terragrunt parser smoke test | `public-gruntwork-live` + `public-gruntwork-modules` |
| Nested HCL / security groups | `public-tfm-security-group` |
| Module version blast radius | `public-tfm-vpc` + `public-binbash-live` |
| Deep module tree stress test | `public-tfm-eks` |
| Full-scale benchmark | All 8 repos |

## Enabling subscriptions

Public repos are registered in `config/repo-subscriptions.json` with **`subscribed: false`** by default. After cloning:

1. Set `"subscribed": true` for the repos you cloned.
2. Ensure `local_path` matches the clone destination (e.g. `mvp_demo/public_repos/public-tfm-vpc`).
3. Re-run the worker subscription sync or restart the stack.

## Size guidance

| Size | Repos | Approx. clone time |
|---|---|---|
| Small | gruntwork-live, gruntwork-modules | < 30 s |
| Medium | tfm-vpc, tfm-security-group | 30–60 s |
| Large | tfm-eks, binbash-live | 1–3 min |
| XLarge | cloudposse-components, gcp-fabric | 3–10 min |

## Troubleshooting

- **Repository not found:** Verify the repo name and that GitHub is reachable. All repos listed here were verified via `git ls-remote` on 2026-07-17.
- **Wrong branch:** Use the `default_branch` from `config/public-test-repos.json` (`main` vs `master`).
- **Worker skips repo:** Check `subscribed: true` and that `local_path` exists on disk relative to the project root.
