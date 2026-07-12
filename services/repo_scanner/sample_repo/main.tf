resource "aws_s3_bucket" "prod_bucket" {
  bucket = "prod-bucket"
  acl    = "private"
}
