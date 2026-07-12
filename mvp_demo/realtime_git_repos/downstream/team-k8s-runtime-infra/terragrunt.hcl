terraform {
  source = "git::ssh://git.example.com/core-engineering/modules//eks-runtime?ref=v2026.07.1"
}

dependency "upstream" {
  config_path = "../../upstream/core-engineering-modules"
}

inputs = {
  cluster_name = "team-k8s-runtime"
}
