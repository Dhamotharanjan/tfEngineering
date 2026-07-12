module "network" {
  source = "../upstream-core-network-modules"
}

module "k8s_platform" {
  source = "../upstream-core-k8s-modules"
}

module "shared_storage" {
  source = "../upstream-core-storage-modules"
}
