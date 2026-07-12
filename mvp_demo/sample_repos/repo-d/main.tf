resource "aws_db_instance" "db" {
  identifier = "app-db"
  engine     = "postgres"
  instance_class = "db.t3.micro"
}
