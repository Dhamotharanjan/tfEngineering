module "core_modules" {
  source = "../../upstream/core-engineering-modules"
}

resource "aws_eks_cluster" "runtime" {
  name     = "team-k8s-runtime"
  role_arn = "arn:aws:iam::111111111111:role/team-k8s-runtime"

  vpc_config {
    subnet_ids = ["subnet-a", "subnet-b"]
  }
}
