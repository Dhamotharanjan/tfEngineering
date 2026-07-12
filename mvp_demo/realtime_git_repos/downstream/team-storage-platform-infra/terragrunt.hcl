terraform {
  source = "git::ssh://git.example.com/core-engineering/modules//storage-platform?ref=v2026.07.1"
}

dependency "upstream" {
  config_path = "../../upstream/core-engineering-modules"
}

inputs = {
  storage_profile = "team-storage-platform"
}
