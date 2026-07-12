terraform {
  source = "git::ssh://git.example.com/core-modules/aws-network//vpc?ref=v2026.07.0"
}

inputs = {
  cidr_block = "10.20.0.0/16"
  team       = "core-engineering"
}
