terraform {
  source = "git::ssh://git.example.com/terraform-modules//s3?ref=v1.0.0"
}

inputs = {
  bucket_name = "app-bucket-old"
}
