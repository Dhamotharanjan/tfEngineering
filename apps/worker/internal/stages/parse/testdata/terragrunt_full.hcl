terraform {
  source = "git::https://github.com/acme/terraform-modules.git//vpc?ref=v2.1.0"
}

include "root" {
  path   = "${get_parent_terragrunt_dir()}/terragrunt.hcl"
  expose = true
}

dependency "network" {
  config_path = "../network"

  mock_outputs = {
    vpc_id         = "vpc-mock-12345"
    private_subnets = ["subnet-mock-a", "subnet-mock-b"]
  }
  mock_outputs_allowed_terraform_commands = ["validate", "plan"]
}

dependencies {
  paths = ["../shared", "../network"]
}

generate "provider" {
  path      = "provider.tf"
  if_exists = "overwrite_terragrunt"
  contents  = <<EOF
provider "aws" {
  region = "us-east-1"
}
EOF
}

locals {
  env = "production"
}

inputs = {
  vpc_id           = dependency.network.outputs.vpc_id
  environment      = local.env
  db_password      = "super-secret-should-redact"
  instance_count   = 3
}
