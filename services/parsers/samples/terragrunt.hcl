# Terragrunt sample (includes a Terraform module or plain HCL)
terraform {
  source = "git::https://example.com/modules/s3.git"
}

inputs = {
  bucket_name = "terragrunt-example"
}
