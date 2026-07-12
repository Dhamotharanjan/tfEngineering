module "network_foundation" {
  source = "../upstream-core-network-modules"
}

resource "aws_ebs_volume" "shared_block" {
  availability_zone = "us-east-1a"
  size              = 2048
  type              = "gp3"
}

resource "aws_efs_file_system" "shared_efs" {
  creation_token = "core-shared-efs"
}

resource "aws_s3_bucket" "shared_bucket" {
  bucket = "core-shared-storage"
}
