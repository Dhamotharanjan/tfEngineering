module "gateway" {
  source = "../repo-h"
}

module "analytics_bridge" {
  source = "../repo-g"
}

resource "aws_db_instance" "warehouse" {
  identifier     = "warehouse-primary"
  engine         = "postgres"
  instance_class = "db.m5.2xlarge"
}

resource "aws_security_group" "warehouse_access" {
  name = "warehouse-open-access"

  ingress {
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
}