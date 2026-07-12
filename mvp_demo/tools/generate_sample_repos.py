import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = ROOT / 'sample_repos'

REPOS = [
    'repo-a',
    'repo-b',
    'repo-c',
    'repo-d',
    'repo-e',
    'repo-f',
    'repo-g',
  'repo-h',
  'repo-i',
  'repo-j',
]

FILES = {
    'repo-a': {
        'main.tf': '''terraform {
  required_version = ">= 1.0"
}

module "storage" {
  source = "../repo-b"
}
module "network" {
  source = "../repo-c"
}
''',
        'terragrunt.hcl': '''terraform {
  source = "git::ssh://git.example.com/terraform-modules//s3?ref=v1.0.0"
}

inputs = {
  bucket_name = "app-bucket-old"
}
'''
    },
    'repo-b': {
        'main.tf': '''module "database" {
  source = "../repo-d"
  bucket = "app-bucket-old"
}
''',
        'terragrunt.hcl': '''terraform {
  source = "git::ssh://git.example.com/terraform-modules//db?ref=v1.0.0"
}

dependency "repo-a" {
  config_path = "../repo-a"
}
'''
    },
    'repo-c': {
        'main.tf': '''resource "aws_lambda_function" "processor" {
  function_name = "processor"
  s3_bucket     = "app-bucket-old"
  handler       = "index.handler"
  runtime       = "nodejs18.x"
}
''',
        'kustomization.yaml': '''resources:
  - ../repo-b
  - ../repo-d
'''
    },
    'repo-d': {
        'main.tf': '''resource "aws_db_instance" "db" {
  identifier      = "app-db"
  engine          = "postgres"
  instance_class  = "db.t3.micro"
}
'''
    },
    'repo-e': {
        'main.tf': '''resource "aws_ecs_service" "service" {
  name            = "app-service"
  cluster         = "default"
  task_definition = "app-task"
}
'''
    },
    'repo-f': {
        'main.tf': '''module "cache" {
  source = "../repo-e"
}
''',
        'deploy.yaml': '''- ../repo-d
- ../repo-g
'''
    },
    'repo-g': {
        'main.tf': '''module "analytics" {
  source = "../repo-a"
}
''',
        'variables.tf': '''variable "app_name" {
  type = string
}
'''
    },
    'repo-h': {
        'main.tf': '''module "messaging" {
  source = "../repo-c"
}

module "observability" {
  source = "../repo-i"
}
''',
        'dependencies.yaml': '''resources:
  - ../repo-f
  - ../repo-j
'''
    },
    'repo-i': {
        'main.tf': '''module "shared_network" {
  source = "../repo-d"
}

module "reporting" {
  source = "../repo-e"
}
''',
        'terragrunt.hcl': '''dependency "repo-b" {
  config_path = "../repo-b"
}
'''
    },
    'repo-j': {
        'main.tf': '''module "gateway" {
  source = "../repo-h"
}

module "analytics_bridge" {
  source = "../repo-g"
}
''',
        'deploy.yaml': '''- ../repo-c
- ../repo-e
'''
    }
}


def generate():
    REPO_ROOT.mkdir(exist_ok=True)
    for repo, files in FILES.items():
        repo_dir = REPO_ROOT / repo
        repo_dir.mkdir(exist_ok=True)
        for filename, content in files.items():
            (repo_dir / filename).write_text(content, encoding='utf-8')
    print('Generated repos:')
    for repo in REPOS:
        print(f'- {repo} ({REPO_ROOT / repo})')


if __name__ == '__main__':
    generate()
