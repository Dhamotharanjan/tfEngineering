terraform {
  required_version = ">= 1.0"
}

resource "aws_s3_bucket" "app_bucket" {
  bucket = "app-bucket-old"
  acl    = "private"
}
