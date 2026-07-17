resource "aws_security_group" "web" {
  name        = "web-sg"
  description = "Web tier security group"
  vpc_id      = aws_vpc.core.id

  tags = {
    Environment = "production"
    Owner       = "platform-team"
    CostCenter  = "CC-1001"
  }

  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["10.0.0.0/8"]
  }

  ingress {
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  dynamic "ingress" {
    for_each = var.extra_ports
    content {
      from_port   = ingress.value
      to_port     = ingress.value
      protocol    = "tcp"
      cidr_blocks = ["10.0.0.0/8"]
    }
  }
}

resource "aws_vpc" "core" {
  cidr_block = "10.0.0.0/16"

  tags = {
    Name = "core-vpc"
  }
}
