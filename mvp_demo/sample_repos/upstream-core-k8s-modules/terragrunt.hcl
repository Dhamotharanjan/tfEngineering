terraform {
  source = "git::ssh://git.example.com/core-modules/aws-compute//eks?ref=v2026.07.0"
}

dependency "core_network" {
  config_path = "../upstream-core-network-modules"
}

inputs = {
  cluster_name = "core-eks-platform"
}
