terraform {
  source = "../modules/db"
}

inputs = {
  db_name = "prod-db"
}
