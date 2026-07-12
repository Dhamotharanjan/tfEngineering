terraform {
  source = "git::ssh://git.example.com/core-engineering/modules//catalog?ref=v2026.07.1"
}

inputs = {
  owner = "core-engineering"
}
