module "shared_network" {
  source = "../repo-d"
}

module "reporting" {
  source = "../repo-e"
}

resource "aws_security_group" "analytics_ingress" {
  name        = "analytics-open-ingress"
  description = "Sample ingress for analytics API"

  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_instance" "analytics_worker" {
  ami           = "ami-0abcd1234"
  instance_type = "m5.4xlarge"
}