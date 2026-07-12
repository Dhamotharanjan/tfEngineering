module "network_foundation" {
  source = "../upstream-core-network-modules"
}

resource "aws_eks_cluster" "platform" {
  name     = "core-eks-platform"
  role_arn = "arn:aws:iam::111111111111:role/core-eks-cluster"

  vpc_config {
    subnet_ids = [
      module.network_foundation.private_subnet_a_id,
      module.network_foundation.private_subnet_b_id,
    ]
  }
}

resource "aws_eks_node_group" "general" {
  cluster_name    = aws_eks_cluster.platform.name
  node_group_name = "general"
  node_role_arn   = "arn:aws:iam::111111111111:role/core-eks-node"
  subnet_ids      = ["subnet-aaa", "subnet-bbb"]

  scaling_config {
    desired_size = 6
    max_size     = 12
    min_size     = 3
  }
}
