module "network" {
  source  = "../upstream-core-network-modules"
  version = "2.4.2"

  providers = {
    aws = aws.primary
  }

  vpc_cidr = var.vpc_cidr
}

module "database" {
  source = "../upstream-core-database-modules"

  vpc_id     = module.network.vpc_id
  subnet_ids = module.network.private_subnet_ids

  depends_on = [module.network]
}

variable "vpc_cidr" {
  type        = string
  default     = "10.0.0.0/16"
  description = "VPC CIDR block"
}

variable "traffic_distribution" {
  type    = map(number)
  default = { canary = 10, stable = 90 }
}

variable "db_password" {
  type      = string
  sensitive = true
  default   = "never-store-this"
}

output "vpc_id" {
  value       = module.network.vpc_id
  sensitive   = false
}

output "db_endpoint" {
  value     = module.database.endpoint
  sensitive = true
}

provider "aws" {
  alias  = "primary"
  region = "us-west-2"
}

terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  backend "s3" {
    bucket = "acme-consumer-tfstate"
    key    = "team-database-platform-infra/terraform.tfstate"
    region = "us-west-2"
  }
}

resource "aws_lb_target_group" "app" {
  name     = "app-tg"
  port     = 8080
  protocol = "HTTP"
  vpc_id   = module.network.vpc_id
}

resource "aws_eks_cluster" "platform" {
  name     = "platform-eks"
  version  = "1.28"
  role_arn = aws_iam_role.cluster.arn
}

resource "aws_iam_role" "cluster" {
  name = "eks-cluster-role"
}
