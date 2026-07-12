terraform {
  source = "git::ssh://git.example.com/core-modules/aws-database//rds?ref=v2026.07.0"
}

inputs = {
  identifier     = "core-primary-db"
  instance_class = "db.m5.2xlarge"
}
