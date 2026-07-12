resource "aws_s3_bucket" "example" {
  bucket = "my-sample-bucket"
  acl    = "private"
}

variable "region" {
  default = "us-east-1"
}
