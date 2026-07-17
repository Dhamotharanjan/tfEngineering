terraform {
  required_version = ">= 1.0"
}

module "network" {
  source = "../upstream-core-network-modules"
}

resource "aws_s3_bucket" "app_bucket" {
  bucket = "app-bucket-checkout-stg"
  acl    = "private"

  tags = {
    Environment = "staging"
    App         = "checkout"
  }
}

resource "aws_instance" "checkout_api" {
  ami           = "ami-0checkoutapi"
  instance_type = "t3.large"

  tags = {
    Name = "checkout-api"
    App  = "checkout"
  }
}

resource "aws_ebs_volume" "checkout_data" {
  availability_zone = "us-east-1a"
  size              = 200
  type              = "gp3"
  encrypted         = true

  tags = {
    Name = "checkout-data"
  }
}

resource "aws_volume_attachment" "checkout_data" {
  device_name = "/dev/sdf"
  volume_id   = aws_ebs_volume.checkout_data.id
  instance_id = aws_instance.checkout_api.id
}
