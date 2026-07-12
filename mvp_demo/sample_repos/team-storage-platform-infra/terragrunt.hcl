terraform {
  source = "git::ssh://git.example.com/core-modules/aws-storage//foundation?ref=v2026.07.0"
}

dependency "core_network" {
  config_path = "../upstream-core-network-modules"
}

inputs = {
  storage_profile = "team-storage"
}
