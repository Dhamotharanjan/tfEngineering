resource "aws_s3_bucket" "example" {
  bucket = "example-bucket"
  acl    = "private"
}

resource "aws_instance" "web" {
  ami           = "ami-123456"
  instance_type = "t2.micro"
  tags = {
    Name = "web-instance"
  }
}
