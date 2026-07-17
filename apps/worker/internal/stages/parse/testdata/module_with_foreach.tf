module "instances" {
  source  = "./modules/ec2"
  version = "1.2.3"

  for_each = toset(["web", "api", "worker"])

  instance_type = "t3.medium"
  subnet_id     = aws_subnet.private[each.key].id

  tags = {
    Role = each.key
  }
}

resource "aws_subnet" "private" {
  for_each = toset(["web", "api", "worker"])

  vpc_id     = aws_vpc.main.id
  cidr_block = cidrsubnet(aws_vpc.main.cidr_block, 8, index(["web", "api", "worker"], each.key))

  tags = {
    Name = "private-${each.key}"
  }
}

resource "aws_vpc" "main" {
  cidr_block = "10.1.0.0/16"
}
