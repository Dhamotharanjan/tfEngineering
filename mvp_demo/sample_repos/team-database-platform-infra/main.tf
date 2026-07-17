module "network" {
  source = "../upstream-core-network-modules"
}

module "database" {
  source = "../upstream-core-database-modules"
}

module "storage" {
  source = "../upstream-core-storage-modules"
}

# Application-owned simple PostgreSQL (APPSVN-1001) → PAT-RDS-PGSQL-SINGLE-AZ-STD
# Demonstrates inherited Layer-1 stamp coverage for Payments Gateway.
resource "aws_db_instance" "payments_app_db" {
  identifier              = "payments-app-db"
  engine                  = "postgres"
  engine_version          = "14.10"
  instance_class          = "db.t3.large"
  allocated_storage       = 200
  storage_encrypted       = true
  multi_az                = false
  availability_zone       = "us-east-1a"
  backup_retention_period = 7
  skip_final_snapshot     = true

  tags = {
    APPSVN        = "APPSVN-1001"
    PatternFamily = "RDS-PGSQL"
    HAPosture     = "single-az"
    Application   = "Payments Gateway"
  }
}
