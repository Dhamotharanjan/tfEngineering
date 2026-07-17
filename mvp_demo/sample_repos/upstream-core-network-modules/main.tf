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

resource "aws_subnet" "public_a" {
  vpc_id                  = aws_vpc.core.id
  cidr_block              = "10.20.10.0/24"
  availability_zone       = "us-east-1a"
  map_public_ip_on_launch = true
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

resource "aws_internet_gateway" "core" {
  vpc_id = aws_vpc.core.id
  tags = {
    Name = "core-igw"
  }
}

resource "aws_eip" "nat" {
  domain = "vpc"
  tags = {
    Name = "core-nat-eip"
  }
}

resource "aws_nat_gateway" "core" {
  allocation_id = aws_eip.nat.id
  subnet_id     = aws_subnet.public_a.id
  tags = {
    Name = "core-nat"
  }
}

resource "aws_route_table" "private" {
  vpc_id = aws_vpc.core.id

  route {
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = aws_nat_gateway.core.id
  }

  tags = {
    Name = "core-private-rt"
  }
}

resource "aws_route_table_association" "private_a" {
  subnet_id      = aws_subnet.private_a.id
  route_table_id = aws_route_table.private.id
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

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_instance" "bastion" {
  ami                    = "ami-0abcdef1234567890"
  instance_type          = "t3.medium"
  subnet_id              = aws_subnet.private_a.id
  vpc_security_group_ids = [aws_security_group.baseline.id]

  tags = {
    Name  = "core-bastion"
    Role  = "bastion"
    Owner = "platform-core"
  }
}
