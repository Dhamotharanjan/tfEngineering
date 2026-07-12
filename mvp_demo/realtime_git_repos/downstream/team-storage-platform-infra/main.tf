module "core_modules" {
  source = "../../upstream/core-engineering-modules"
}

resource "aws_s3_bucket" "shared" {
  bucket = "team-storage-platform-shared"
}

resource "aws_efs_file_system" "shared" {
  creation_token = "team-storage-platform"
}
