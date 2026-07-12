module "messaging" {
  source = "../repo-c"
}

module "observability" {
  source = "../repo-i"
}

resource "aws_instance" "edge_gateway" {
  ami           = "ami-0abcd1234"
  instance_type = "m5.4xlarge"
}

resource "aws_security_group" "edge_ingress" {
  name = "edge-public-gateway"

  ingress {
    from_port   = 8443
    to_port     = 8443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
}