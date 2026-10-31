# EKS cluster. Both API endpoints are enabled: private for in-cluster
# access, public (restricted to var.api_allowed_cidrs) so `aws eks
# update-kubeconfig` works from your machine.

module "eks" {
  source  = "terraform-aws-modules/eks/aws"
  version = "21.29.0"

  name               = var.cluster_name
  kubernetes_version = var.kubernetes_version

  vpc_id     = module.vpc.vpc_id
  subnet_ids = module.vpc.private_subnets

  create_iam_role = true

  endpoint_private_access      = true
  endpoint_public_access       = true
  endpoint_public_access_cidrs = var.api_allowed_cidrs

  # The deploying identity keeps admin permissions so that
  # `aws eks update-kubeconfig` works.
  enable_cluster_creator_admin_permissions = true

  # The addons that ship with the cluster. Empty object = the module's
  # (most recent) addon version.
  addons = {
    vpc-cni                  = {}
    kube-proxy               = {}
    coredns                  = {}
    "eks-pod-identity-agent" = {}
  }

  # The initial node group. Some pods have to be running before Karpenter can
  # launch a single node: Karpenter itself (its chart refuses to run on a node it
  # created) and CoreDNS, which every pod needs. The other CPU-only controllers
  # (the AWS Load Balancer Controller, Envoy Gateway, KEDA, Prometheus, the
  # endpoint picker) run here too, so the GPU nodes only carry vLLM. Two
  # m5.xlarge nodes fit all of that, and no taint is needed because the GPU
  # taint already keeps other pods off the GPU nodes. Bottlerocket x86; the
  # module picks the newest EKS-optimized Bottlerocket AMI for this version.
  eks_managed_node_groups = {
    system = {
      ami_type       = "BOTTLEROCKET_x86_64"
      instance_types = [var.system_instance_type]

      min_size     = var.system_node_group_min_size
      max_size     = var.system_node_group_max_size
      desired_size = var.system_node_group_desired_size
    }
  }

  # Karpenter discovers node-group capacity through this tag on the
  # node security group.
  node_security_group_tags = {
    "karpenter.sh/discovery" = var.cluster_name
  }

  tags = var.tags
}
