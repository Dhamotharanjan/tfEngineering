terraform {
  source = "git::ssh://git.example.com/terraform-modules//db?ref=v1.0.0"
}

dependency "repo-a" {
  config_path = "../repo-a"
}
