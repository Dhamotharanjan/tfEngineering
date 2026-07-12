resource "aws_vpc" "core" {
  cidr_block = "10.30.0.0/16"
}

resource "aws_security_group" "baseline" {
  name   = "core-baseline"
  vpc_id = aws_vpc.core.id

  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["10.0.0.0/8"]
  }
}
