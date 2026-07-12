terraform {
  required_version = ">= 1.5.0"
}

resource "aws_vpc" "core" {
  cidr_block           = "10.20.0.0/16"
  enable_dns_hostnames = true
  tags = {
    Name  = "core-network-vpc"
    owner = "core-engineering"
  }
}

resource "aws_subnet" "private_a" {
  vpc_id            = aws_vpc.core.id
  cidr_block        = "10.20.1.0/24"
  availability_zone = "us-east-1a"
}

resource "aws_subnet" "private_b" {
  vpc_id            = aws_vpc.core.id
  cidr_block        = "10.20.2.0/24"
  availability_zone = "us-east-1b"
}

resource "aws_security_group" "baseline" {
  name   = "core-baseline-sg"
  vpc_id = aws_vpc.core.id

  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["10.0.0.0/8"]
  }
}
