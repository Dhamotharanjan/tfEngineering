terraform {
  source = "git::ssh://git.example.com/core-engineering/modules//database-platform?ref=v2026.07.1"
}

dependency "upstream" {
  config_path = "../../upstream/core-engineering-modules"
}

inputs = {
  db_identifier = "team-database-platform"
}
