from __future__ import annotations

import shutil
import subprocess
from pathlib import Path
from textwrap import dedent

ROOT = Path(__file__).resolve().parents[1]
TARGET_ROOT = ROOT / "realtime_git_repos"
UPSTREAM_REPO = TARGET_ROOT / "upstream" / "core-engineering-modules"
DOWNSTREAM_ROOT = TARGET_ROOT / "downstream"

MODULES = {
    "vpc": {
        "main.tf": dedent(
            """
            resource "aws_vpc" "this" {
              cidr_block           = var.cidr_block
              enable_dns_hostnames = true
              tags = {
                Name = var.name
              }
            }

            resource "aws_subnet" "private" {
              count             = length(var.private_subnet_cidrs)
              vpc_id            = aws_vpc.this.id
              cidr_block        = var.private_subnet_cidrs[count.index]
              availability_zone = var.azs[count.index]
            }
            """
        ).strip()
        + "\n",
        "variables.tf": dedent(
            """
            variable "name" {
              type = string
            }

            variable "cidr_block" {
              type = string
            }

            variable "private_subnet_cidrs" {
              type = list(string)
            }

            variable "azs" {
              type = list(string)
            }
            """
        ).strip()
        + "\n",
        "outputs.tf": dedent(
            """
            output "vpc_id" {
              value = aws_vpc.this.id
            }
            """
        ).strip()
        + "\n",
    },
    "eks": {
        "main.tf": dedent(
            """
            resource "aws_eks_cluster" "this" {
              name     = var.cluster_name
              role_arn = var.cluster_role_arn
              vpc_config {
                subnet_ids = var.subnet_ids
              }
            }

            resource "aws_eks_node_group" "primary" {
              cluster_name    = aws_eks_cluster.this.name
              node_group_name = "${var.cluster_name}-ng"
              node_role_arn   = var.node_role_arn
              subnet_ids      = var.subnet_ids
              scaling_config {
                desired_size = var.desired_nodes
                max_size     = var.max_nodes
                min_size     = var.min_nodes
              }
            }
            """
        ).strip()
        + "\n",
        "variables.tf": dedent(
            """
            variable "cluster_name" { type = string }
            variable "cluster_role_arn" { type = string }
            variable "node_role_arn" { type = string }
            variable "subnet_ids" { type = list(string) }
            variable "desired_nodes" { type = number }
            variable "max_nodes" { type = number }
            variable "min_nodes" { type = number }
            """
        ).strip()
        + "\n",
    },
    "ecs": {
        "main.tf": dedent(
            """
            resource "aws_ecs_cluster" "this" {
              name = var.cluster_name
            }
            """
        ).strip()
        + "\n",
        "variables.tf": 'variable "cluster_name" { type = string }\n',
    },
    "rds": {
        "main.tf": dedent(
            """
            resource "aws_db_instance" "this" {
              identifier         = var.identifier
              engine             = "postgres"
              instance_class     = var.instance_class
              allocated_storage  = var.allocated_storage
              skip_final_snapshot = true
            }
            """
        ).strip()
        + "\n",
        "variables.tf": dedent(
            """
            variable "identifier" { type = string }
            variable "instance_class" { type = string }
            variable "allocated_storage" { type = number }
            """
        ).strip()
        + "\n",
    },
    "s3": {
        "main.tf": dedent(
            """
            resource "aws_s3_bucket" "this" {
              bucket = var.bucket_name
            }
            """
        ).strip()
        + "\n",
        "variables.tf": 'variable "bucket_name" { type = string }\n',
    },
    "ebs": {
        "main.tf": dedent(
            """
            resource "aws_ebs_volume" "this" {
              availability_zone = var.availability_zone
              size              = var.size
              type              = var.type
            }
            """
        ).strip()
        + "\n",
        "variables.tf": dedent(
            """
            variable "availability_zone" { type = string }
            variable "size" { type = number }
            variable "type" { type = string }
            """
        ).strip()
        + "\n",
    },
    "efs": {
        "main.tf": dedent(
            """
            resource "aws_efs_file_system" "this" {
              creation_token = var.name
            }
            """
        ).strip()
        + "\n",
        "variables.tf": 'variable "name" { type = string }\n',
    },
    "elasticache": {
        "main.tf": dedent(
            """
            resource "aws_elasticache_cluster" "this" {
              cluster_id           = var.cluster_id
              engine               = "redis"
              node_type            = var.node_type
              num_cache_nodes      = var.num_cache_nodes
              parameter_group_name = "default.redis7"
            }
            """
        ).strip()
        + "\n",
        "variables.tf": dedent(
            """
            variable "cluster_id" { type = string }
            variable "node_type" { type = string }
            variable "num_cache_nodes" { type = number }
            """
        ).strip()
        + "\n",
    },
    "alb": {
        "main.tf": dedent(
            """
            resource "aws_lb" "this" {
              name               = var.name
              load_balancer_type = "application"
              internal           = false
              subnets            = var.subnet_ids
            }
            """
        ).strip()
        + "\n",
        "variables.tf": dedent(
            """
            variable "name" { type = string }
            variable "subnet_ids" { type = list(string) }
            """
        ).strip()
        + "\n",
    },
    "security_group": {
        "main.tf": dedent(
            """
            resource "aws_security_group" "this" {
              name   = var.name
              vpc_id = var.vpc_id

              ingress {
                from_port   = 443
                to_port     = 443
                protocol    = "tcp"
                cidr_blocks = var.allowed_cidrs
              }
            }
            """
        ).strip()
        + "\n",
        "variables.tf": dedent(
            """
            variable "name" { type = string }
            variable "vpc_id" { type = string }
            variable "allowed_cidrs" { type = list(string) }
            """
        ).strip()
        + "\n",
    },
}


def run_git(path: Path, *args: str) -> None:
    subprocess.run(["git", *args], cwd=path, check=True)


def write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def init_repo(path: Path, initial_message: str, tag: str) -> None:
    run_git(path, "init")
    run_git(path, "checkout", "-B", "main")
    run_git(path, "config", "user.name", "TFEngineering Bot")
    run_git(path, "config", "user.email", "tfengineering-bot@example.local")
    run_git(path, "add", ".")
    run_git(path, "commit", "-m", initial_message)
    run_git(path, "tag", "-a", tag, "-m", f"Release {tag}")


def create_upstream_repo() -> None:
    if UPSTREAM_REPO.exists():
        shutil.rmtree(UPSTREAM_REPO)
    UPSTREAM_REPO.mkdir(parents=True, exist_ok=True)

    write(
        UPSTREAM_REPO / "README.md",
        dedent(
            """
            # AWS Upstream Modules

            Upstream module catalog owned by core engineering.
            Downstream teams consume modules using git tags.
            """
        ).strip()
        + "\n",
    )

    for module_name, module_files in MODULES.items():
        for filename, content in module_files.items():
            write(UPSTREAM_REPO / "modules" / module_name / filename, content)

    write(
        UPSTREAM_REPO / "versions.tf",
        dedent(
            """
            terraform {
              required_version = ">= 1.5.0"
              required_providers {
                aws = {
                  source  = "hashicorp/aws"
                  version = ">= 5.0"
                }
              }
            }
            """
        ).strip()
        + "\n",
    )

    init_repo(UPSTREAM_REPO, "Initial upstream AWS module catalog", "v1.0.0")

    # Release patch: harden SG module defaults to private network range
    sg_main = (UPSTREAM_REPO / "modules" / "security_group" / "main.tf").read_text(encoding="utf-8")
    sg_main = sg_main.replace("cidr_blocks = var.allowed_cidrs", "cidr_blocks = length(var.allowed_cidrs) > 0 ? var.allowed_cidrs : [\"10.0.0.0/8\"]")
    write(UPSTREAM_REPO / "modules" / "security_group" / "main.tf", sg_main)
    run_git(UPSTREAM_REPO, "add", ".")
    run_git(UPSTREAM_REPO, "commit", "-m", "Harden security-group module defaults")
    run_git(UPSTREAM_REPO, "tag", "-a", "v1.1.0", "-m", "Release v1.1.0")


def module_source(module_name: str, tag: str = "v1.1.0") -> str:
    return f'git::file://{UPSTREAM_REPO.as_posix()}//modules/{module_name}?ref={tag}'


def create_team_repo(team: str, description: str, files: dict[str, str], tag: str) -> None:
    repo_path = DOWNSTREAM_ROOT / team
    if repo_path.exists():
        shutil.rmtree(repo_path)
    repo_path.mkdir(parents=True, exist_ok=True)

    write(
        repo_path / "README.md",
        dedent(
            f"""
            # {team}

            {description}

            This downstream repo consumes upstream modules via git release tags.
            """
        ).strip()
        + "\n",
    )

    for rel_path, content in files.items():
        write(repo_path / rel_path, content)

    init_repo(repo_path, f"Initial {team} infrastructure using upstream modules", tag)


def create_downstream_repos() -> None:
    teams = {
    "team-k8s-runtime-infra": {
            "description": "K8s team building container platform and networking foundations.",
            "tag": "team-v1.0.0",
            "files": {
                "main.tf": dedent(
                    f"""
                    module "network" {{
                      source                = "{module_source('vpc')}"
                      name                  = "k8s-team-vpc"
                      cidr_block            = "10.42.0.0/16"
                      private_subnet_cidrs  = ["10.42.1.0/24", "10.42.2.0/24"]
                      azs                   = ["us-east-1a", "us-east-1b"]
                    }}

                    module "cluster" {{
                      source           = "{module_source('eks')}"
                      cluster_name     = "k8s-prod"
                      cluster_role_arn = "arn:aws:iam::111111111111:role/eks-cluster"
                      node_role_arn    = "arn:aws:iam::111111111111:role/eks-node"
                      subnet_ids       = ["subnet-111", "subnet-222"]
                      desired_nodes    = 6
                      max_nodes        = 12
                      min_nodes        = 3
                    }}

                    module "ingress_alb" {{
                      source     = "{module_source('alb')}"
                      name       = "k8s-ingress"
                      subnet_ids = ["subnet-111", "subnet-222"]
                    }}
                    """
                ).strip()
                + "\n",
                "terragrunt.hcl": dedent(
                    f"""
                    terraform {{
                      source = "{module_source('eks')}"
                    }}

                    inputs = {{
                      cluster_name  = "k8s-prod"
                      desired_nodes = 6
                      max_nodes     = 12
                      min_nodes     = 3
                    }}
                    """
                ).strip()
                + "\n",
            },
        },
        "team-database-platform-infra": {
            "description": "Database team building RDS, backups, and durable data services.",
            "tag": "team-v1.0.0",
            "files": {
                "main.tf": dedent(
                    f"""
                    module "primary_rds" {{
                      source            = "{module_source('rds')}"
                      identifier        = "db-team-primary"
                      instance_class    = "db.m5.2xlarge"
                      allocated_storage = 1500
                    }}

                    module "db_backups" {{
                      source      = "{module_source('s3')}"
                      bucket_name = "db-team-backups-prod"
                    }}

                    module "db_cache" {{
                      source          = "{module_source('elasticache')}"
                      cluster_id      = "db-team-cache"
                      node_type       = "cache.m6g.large"
                      num_cache_nodes = 3
                    }}
                    """
                ).strip()
                + "\n",
                "terragrunt.hcl": dedent(
                    f"""
                    terraform {{
                      source = "{module_source('rds')}"
                    }}

                    dependency "k8s_team" {{
                      config_path = "../team-k8s-runtime-infra"
                    }}

                    inputs = {{
                      identifier        = "db-team-primary"
                      instance_class    = "db.m5.2xlarge"
                      allocated_storage = 1500
                    }}
                    """
                ).strip()
                + "\n",
            },
        },
        "team-storage-platform-infra": {
            "description": "Storage team building EBS/EFS/S3-based storage foundations.",
            "tag": "team-v1.0.0",
            "files": {
                "main.tf": dedent(
                    f"""
                    module "object_storage" {{
                      source      = "{module_source('s3')}"
                      bucket_name = "storage-team-shared-artifacts"
                    }}

                    module "block_storage" {{
                      source            = "{module_source('ebs')}"
                      availability_zone = "us-east-1a"
                      size              = 2048
                      type              = "gp3"
                    }}

                    module "file_storage" {{
                      source = "{module_source('efs')}"
                      name   = "storage-team-efs"
                    }}

                    module "storage_security" {{
                      source        = "{module_source('security_group')}"
                      name          = "storage-team-sg"
                      vpc_id        = "vpc-123456"
                      allowed_cidrs = ["0.0.0.0/0"]
                    }}
                    """
                ).strip()
                + "\n",
                "terragrunt.hcl": dedent(
                    f"""
                    terraform {{
                      source = "{module_source('s3')}"
                    }}

                    dependencies {{
                      paths = ["../team-database-platform-infra", "../team-k8s-runtime-infra"]
                    }}

                    inputs = {{
                      bucket_name = "storage-team-shared-artifacts"
                    }}
                    """
                ).strip()
                + "\n",
            },
        },
    }

    for team, cfg in teams.items():
        create_team_repo(team, cfg["description"], cfg["files"], cfg["tag"])


def generate() -> None:
    TARGET_ROOT.mkdir(parents=True, exist_ok=True)
    create_upstream_repo()
    create_downstream_repos()

  expected_paths = [
    UPSTREAM_REPO,
    DOWNSTREAM_ROOT / "team-k8s-runtime-infra",
    DOWNSTREAM_ROOT / "team-database-platform-infra",
    DOWNSTREAM_ROOT / "team-storage-platform-infra",
  ]
  missing = [str(p) for p in expected_paths if not p.exists()]
  if missing:
    raise RuntimeError(f"Generation incomplete, missing paths: {missing}")

    print("Generated realtime git repos:")
    print(f"- Upstream: {UPSTREAM_REPO}")
    for path in sorted((DOWNSTREAM_ROOT).iterdir()):
        if path.is_dir():
            print(f"- Downstream: {path}")


if __name__ == "__main__":
    generate()
