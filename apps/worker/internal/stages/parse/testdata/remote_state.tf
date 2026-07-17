data "terraform_remote_state" "network" {
  backend = "s3"

  config = {
    bucket = "acme-tfstate-prod"
    key    = "team-network-platform-infra/terraform.tfstate"
    region = "us-east-1"
  }
}

resource "aws_db_instance" "payments" {
  identifier        = "payments-db"
  engine            = "postgres"
  engine_version    = "14.10"
  instance_class    = "db.r6g.large"
  storage_encrypted = false

  vpc_security_group_ids = [aws_security_group.db.id]
  db_subnet_group_name   = data.terraform_remote_state.network.outputs.db_subnet_group

  tags = {
    Environment = "production"
    Application = "payments"
  }
}

resource "aws_security_group" "db" {
  name   = "payments-db-sg"
  vpc_id = data.terraform_remote_state.network.outputs.vpc_id
}
