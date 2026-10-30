# VPC: three public /24 subnets (NAT egress) and three private /20 subnets
# (all node groups), cut out of vpc_cidr (a /16). The private blocks start
# at index 1 so they skip the /20 that contains the public /24s.

data "aws_availability_zones" "available" {
  state = "available"
}

locals {
  # Sorted so the same three AZs are picked on every plan.
  azs = slice(sort(data.aws_availability_zones.available.names), 0, 3)

  public_subnets  = [for i in range(3) : cidrsubnet(var.vpc_cidr, 24, i)]
  private_subnets = [for i in range(3) : cidrsubnet(var.vpc_cidr, 20, 1 + i)]
}

module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "6.7.3"

  name = "${var.cluster_name}-vpc"

  cidr = var.vpc_cidr
  azs  = local.azs

  public_subnets  = local.public_subnets
  private_subnets = local.private_subnets

  enable_dns_support   = true
  enable_dns_hostnames = true

  # One NAT gateway total, so private subnets can egress for image pulls
  # and S3 access.
  enable_nat_gateway = var.enable_nat_gateway
  single_nat_gateway = var.enable_nat_gateway

  # Subnet role tags: LoadBalancer services use the elb subnets,
  # in-cluster (internal) LoadBalancers the internal-elb ones.
  # karpenter.sh/discovery is private-only so Karpenter never places
  # nodes where public IPs apply.
  public_subnet_tags = {
    "kubernetes.io/role/elb" = "1"
  }

  private_subnet_tags = {
    "karpenter.sh/discovery"          = var.cluster_name
    "kubernetes.io/role/internal-elb" = "1"
  }
}
