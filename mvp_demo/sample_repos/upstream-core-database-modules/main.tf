module "network_foundation" {
  source = "../upstream-core-network-modules"
}

resource "aws_db_instance" "primary" {
  identifier      = "core-primary-db"
  engine          = "postgres"
  instance_class  = "db.m5.2xlarge"
  allocated_storage = 1200
  skip_final_snapshot = true
}

resource "aws_s3_bucket" "backup" {
  bucket = "core-database-backup-artifacts"
}
