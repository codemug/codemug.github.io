# AWS Load Balancer Controller. This is what turns the Envoy gateway's
# Service (loadBalancerClass: service.k8s.aws/nlb) into an NLB, and it
# reads the kubernetes.io/role/elb and kubernetes.io/role/internal-elb
# subnet tags (set in vpc.tf) to choose the subnets the load balancer uses.

module "lb_controller" {
  source  = "terraform-aws-modules/eks-pod-identity/aws"
  version = "2.10.0"

  name = "aws-load-balancer-controller"

  # Attaches the controller's IAM policy (the one from the upstream
  # documentation) instead of copying the long policy document here.
  attach_aws_lb_controller_policy = true

  # Trust policy is the module default: Service principal
  # pods.eks.amazonaws.com with sts:AssumeRole and sts:TagSession, the same
  # pattern as pod_identity.tf.
  associations = {
    this = {
      cluster_name    = var.cluster_name
      namespace       = "kube-system"
      service_account = "aws-load-balancer-controller"
    }
  }

  tags = var.tags

  # The association needs a running cluster.
  depends_on = [module.eks]
}

resource "helm_release" "aws_load_balancer_controller" {
  name       = "aws-load-balancer-controller"
  repository = "https://aws.github.io/eks-charts"
  chart      = "aws-load-balancer-controller"
  # 3.6.2, the latest chart in https://aws.github.io/eks-charts
  # (appVersion v3.6.2).
  version   = "3.6.2"
  namespace = "kube-system"

  values = [yamlencode({
    clusterName = var.cluster_name
    region      = var.region
    vpcId       = module.vpc.vpc_id
    serviceAccount = {
      create = true
      name   = "aws-load-balancer-controller"
    }
  })]

  depends_on = [module.lb_controller]
}
