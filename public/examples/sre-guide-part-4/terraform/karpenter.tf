# Karpenter, the AWS side: the node IAM role + instance profile for the
# nodes Karpenter provisions, the SQS interruption queue (the two-minute
# Spot notice), and the controller identity via EKS Pod Identity. The
# association points at a service account the chart release below
# creates; EKS Pod Identity associations are eventually consistent.

module "karpenter" {
  source  = "terraform-aws-modules/eks/aws//modules/karpenter"
  version = "21.29.0"

  cluster_name = var.cluster_name
  region       = var.region

  namespace       = "karpenter"
  service_account = "karpenter"

  # The Pod Identity association is created by default in the submodule.
  enable_spot_termination = true
  tags                    = var.tags

  # The access entry and the association need a running cluster.
  depends_on = [module.eks]
}

resource "helm_release" "karpenter" {
  name             = "karpenter"
  repository       = "oci://public.ecr.aws/karpenter"
  chart            = "karpenter"
  version          = "1.15.1"
  namespace        = "karpenter"
  create_namespace = true

  # serviceAccount.name is pinned to the association above. The
  # EC2NodeClass in the model chart uses the node role from output
  # node_role_name.
  values = [yamlencode({
    serviceAccount = {
      name = "karpenter"
    }
    settings = {
      clusterName       = var.cluster_name
      interruptionQueue = module.karpenter.queue_name
    }
  })]
}
