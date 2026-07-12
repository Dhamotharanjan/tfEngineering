module "network" {
  source = "../upstream-core-network-modules"
}

module "database" {
  source = "../upstream-core-database-modules"
}

module "storage" {
  source = "../upstream-core-storage-modules"
}
