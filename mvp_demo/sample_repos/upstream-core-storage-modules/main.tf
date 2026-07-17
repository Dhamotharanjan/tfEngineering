module "network_foundation" {
  source = "../upstream-core-network-modules"
}

resource "aws_kms_key" "storage" {
  description             = "Shared storage encryption key"
  deletion_window_in_days = 30
  enable_key_rotation     = true
}

resource "aws_s3_bucket" "shared_bucket" {
  bucket = "core-shared-storage"

  tags = {
    Purpose = "platform-shared"
    Owner   = "storage-platform"
  }
}

resource "aws_s3_bucket" "archive" {
  bucket = "core-compliance-archive"

  tags = {
    Purpose = "compliance-archive"
    Owner   = "storage-platform"
  }
}

resource "aws_ebs_volume" "shared_block" {
  availability_zone = "us-east-1a"
  size              = 2048
  type              = "gp3"
  encrypted         = true
  kms_key_id        = aws_kms_key.storage.arn

  tags = {
    Name = "core-shared-block"
  }
}

resource "aws_efs_file_system" "shared_efs" {
  creation_token = "core-shared-efs"
  encrypted      = true
  kms_key_id     = aws_kms_key.storage.arn

  tags = {
    Name = "core-shared-efs"
  }
}

resource "aws_instance" "storage_gateway" {
  ami           = "ami-0storagegateway"
  instance_type = "m5.large"

  tags = {
    Name = "storage-gateway"
    Role = "file-gateway"
  }
}
