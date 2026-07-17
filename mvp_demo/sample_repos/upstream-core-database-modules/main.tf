module "network_foundation" {
  source = "../upstream-core-network-modules"
}

resource "aws_kms_key" "rds" {
  description             = "RDS encryption key"
  deletion_window_in_days = 30
  enable_key_rotation     = true
}

# DB security group — auditor ingress/egress with explicit ports/protocols
resource "aws_security_group" "rds_access" {
  name        = "core-rds-access"
  description = "RDS/Aurora data-plane access"
  vpc_id      = "vpc-core-network"

  ingress {
    description = "PostgreSQL from corporate / app CIDR"
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    cidr_blocks = ["10.0.0.0/8"]
  }

  ingress {
    description = "SQL Server from app subnet"
    from_port   = 1433
    to_port     = 1433
    protocol    = "tcp"
    cidr_blocks = ["10.20.0.0/16"]
  }

  egress {
    description = "Allow all egress (patches / S3 backups via NAT)"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name    = "core-rds-access"
    Purpose = "pattern-architecture"
  }
}

resource "aws_security_group" "oracle_access" {
  name        = "core-oracle-access"
  description = "EC2 Oracle listener access"
  vpc_id      = "vpc-core-network"

  ingress {
    description = "Oracle listener"
    from_port   = 1521
    to_port     = 1521
    protocol    = "tcp"
    cidr_blocks = ["10.0.0.0/8"]
  }

  egress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# ---------------------------------------------------------------------------
# RDS-PGSQL — Complex: Multi-AZ HA  → PAT-RDS-PGSQL-MULTIAZ-HA
# ---------------------------------------------------------------------------
resource "aws_db_instance" "primary" {
  identifier            = "core-primary-db"
  engine                = "postgres"
  engine_version        = "14.12"
  instance_class        = "db.m5.2xlarge"
  allocated_storage     = 1200
  storage_encrypted     = true
  multi_az              = true
  backup_retention_period = 14
  kms_key_id            = aws_kms_key.rds.arn
  skip_final_snapshot   = true
  db_subnet_group_name  = "core-db-subnets"
  vpc_security_group_ids = [aws_security_group.rds_access.id]

  tags = {
    PatternFamily = "RDS-PGSQL"
    HAPosture     = "multi-az"
  }
}

# ---------------------------------------------------------------------------
# RDS-PGSQL — Simple: single-AZ standard  → PAT-RDS-PGSQL-SINGLE-AZ-STD
# ---------------------------------------------------------------------------
resource "aws_db_instance" "analytics_std" {
  identifier            = "core-analytics-std"
  engine                = "postgres"
  engine_version        = "14.12"
  instance_class        = "db.t3.medium"
  allocated_storage     = 100
  storage_encrypted     = true
  multi_az              = false
  availability_zone     = "us-east-1a"
  backup_retention_period = 7
  skip_final_snapshot   = true
  db_subnet_group_name  = "core-db-subnets"
  vpc_security_group_ids = [aws_security_group.rds_access.id]

  tags = {
    PatternFamily = "RDS-PGSQL"
    HAPosture     = "single-az"
  }
}

# ---------------------------------------------------------------------------
# RDS-MSSQL — Simple + Complex
# ---------------------------------------------------------------------------
resource "aws_db_instance" "mssql_std" {
  identifier             = "core-mssql-std"
  engine                 = "sqlserver-se"
  engine_version         = "15.00"
  instance_class         = "db.m5.large"
  allocated_storage      = 200
  storage_encrypted      = true
  multi_az               = false
  availability_zone      = "us-east-1a"
  skip_final_snapshot    = true
  license_model          = "license-included"
  vpc_security_group_ids = [aws_security_group.rds_access.id]

  tags = {
    PatternFamily = "RDS-MSSQL"
    HAPosture     = "single-az"
  }
}

resource "aws_db_instance" "mssql_ha" {
  identifier             = "core-mssql-ha"
  engine                 = "sqlserver-ee"
  engine_version         = "15.00"
  instance_class         = "db.m5.xlarge"
  allocated_storage      = 500
  storage_encrypted      = true
  multi_az               = true
  skip_final_snapshot    = true
  license_model          = "license-included"
  vpc_security_group_ids = [aws_security_group.rds_access.id]

  tags = {
    PatternFamily = "RDS-MSSQL"
    HAPosture     = "multi-az"
  }
}

# ---------------------------------------------------------------------------
# RDS-APGSQL — Aurora PostgreSQL simple writer + HA cluster
# ---------------------------------------------------------------------------
resource "aws_rds_cluster" "aurora_pg_simple" {
  cluster_identifier = "core-aurora-pg-simple"
  engine             = "aurora-postgresql"
  engine_version     = "14.9"
  database_name      = "appdb"
  storage_encrypted  = true
  availability_zones = ["us-east-1a"]

  tags = {
    PatternFamily = "RDS-APGSQL"
    HAPosture     = "single-writer"
  }
}

resource "aws_rds_cluster_instance" "aurora_pg_simple_writer" {
  identifier         = "core-aurora-pg-simple-writer"
  cluster_identifier = aws_rds_cluster.aurora_pg_simple.id
  instance_class     = "db.r5.large"
  engine             = "aurora-postgresql"
}

resource "aws_rds_cluster" "aurora_pg_ha" {
  cluster_identifier = "core-aurora-pg-ha"
  engine             = "aurora-postgresql"
  engine_version     = "14.9"
  database_name      = "payments"
  storage_encrypted  = true
  availability_zones = ["us-east-1a", "us-east-1b", "us-east-1c"]

  tags = {
    PatternFamily = "RDS-APGSQL"
    HAPosture     = "multi-az-ha"
  }
}

resource "aws_rds_cluster_instance" "aurora_pg_ha_writer" {
  identifier         = "core-aurora-pg-ha-writer"
  cluster_identifier = aws_rds_cluster.aurora_pg_ha.id
  instance_class     = "db.r5.xlarge"
  engine             = "aurora-postgresql"
}

resource "aws_rds_cluster_instance" "aurora_pg_ha_reader" {
  identifier         = "core-aurora-pg-ha-reader"
  cluster_identifier = aws_rds_cluster.aurora_pg_ha.id
  instance_class     = "db.r5.large"
  engine             = "aurora-postgresql"

  tags = {
    Role = "reader"
  }
}

resource "aws_s3_bucket" "backup" {
  bucket = "core-database-backup-artifacts"

  tags = {
    Purpose = "rds-backups"
    Owner   = "database-platform"
  }
}

# ---------------------------------------------------------------------------
# Ec2Oracle — Simple single + Complex DR pair
# ---------------------------------------------------------------------------
resource "aws_instance" "oracle_app" {
  ami                    = "ami-oracle-linux-8"
  instance_type          = "r5.2xlarge"
  subnet_id              = "subnet-private-a"
  availability_zone      = "us-east-1a"
  vpc_security_group_ids = [aws_security_group.oracle_access.id]

  root_block_device {
    volume_type = "gp3"
    volume_size = 100
    encrypted   = true
  }

  tags = {
    Name          = "oracle-payments-app"
    Application   = "oracle"
    Engine        = "Oracle"
    Role          = "primary"
    PatternFamily = "Ec2Oracle"
    Owner         = "database-platform"
  }
}

resource "aws_instance" "oracle_dr" {
  ami               = "ami-oracle-linux-8"
  instance_type     = "r5.2xlarge"
  subnet_id         = "subnet-private-b"
  availability_zone = "us-east-1b"

  root_block_device {
    volume_type = "gp3"
    volume_size = 100
    encrypted   = true
  }

  tags = {
    Name          = "oracle-payments-dr"
    Application   = "oracle"
    Engine        = "Oracle"
    Role          = "dr-standby"
    PatternFamily = "Ec2Oracle"
    DR            = "true"
    Owner         = "database-platform"
  }
}

resource "aws_ebs_volume" "oracle_data" {
  availability_zone = "us-east-1a"
  size              = 2048
  type              = "io2"
  iops              = 8000
  encrypted         = true
  kms_key_id        = aws_kms_key.rds.arn

  tags = {
    Name        = "oracle-data-vol"
    Application = "oracle"
  }
}

resource "aws_volume_attachment" "oracle_data" {
  device_name = "/dev/sdf"
  volume_id   = aws_ebs_volume.oracle_data.id
  instance_id = aws_instance.oracle_app.id
}
