terraform {
  source = "git::ssh://git.example.com/core-modules/aws-storage//foundation?ref=v2026.07.0"
}

inputs = {
  storage_profile = "core-shared"
}
