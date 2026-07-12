module "core_modules" {
  source = "../../upstream/core-engineering-modules"
}

resource "aws_db_instance" "platform" {
  identifier           = "team-database-platform"
  engine               = "postgres"
  instance_class       = "db.m5.2xlarge"
  allocated_storage    = 1200
  skip_final_snapshot  = true
}
