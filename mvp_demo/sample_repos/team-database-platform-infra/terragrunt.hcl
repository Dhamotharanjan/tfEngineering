terraform {
  source = "git::ssh://git.example.com/core-modules/aws-database//rds?ref=v2026.07.0"
}

dependencies {
  paths = ["../team-k8s-runtime-infra", "../upstream-core-network-modules"]
}

inputs = {
  identifier     = "team-database-primary"
  instance_class = "db.m5.2xlarge"
}
