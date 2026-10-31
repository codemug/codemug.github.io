# IAM identity for the vLLM pods, via EKS Pod Identity (the alternative
# is IRSA: an OIDC provider, STS conditions and a service account
# annotation). The role can only list the bucket and read its objects.
# The service account (namespace llm, name = the model name) is created
# by the llm-serving Helm chart after this apply.

# The trust policy is the one the AWS documentation gives for EKS Pod
# Identity (https://docs.aws.amazon.com/eks/latest/userguide/pod-identity.html):
# a Service principal, not the Federated principal IRSA uses.
data "aws_iam_policy_document" "vllm_assume" {
  statement {
    sid     = "Pods"
    actions = ["sts:AssumeRole", "sts:TagSession"]

    principals {
      type        = "Service"
      identifiers = ["pods.eks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "vllm" {
  name               = "${var.cluster_name}-vllm-${var.model_name}"
  assume_role_policy = data.aws_iam_policy_document.vllm_assume.json
}

data "aws_iam_policy_document" "vllm_s3_read" {
  statement {
    sid       = "ListBucket"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.models.arn]
  }

  statement {
    sid       = "ReadObjects"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.models.arn}/*"]
  }
}

resource "aws_iam_role_policy" "vllm_s3_read" {
  name   = "vllm-s3-read"
  role   = aws_iam_role.vllm.id
  policy = data.aws_iam_policy_document.vllm_s3_read.json
}

resource "aws_eks_pod_identity_association" "vllm" {
  cluster_name    = var.cluster_name
  namespace       = "llm"
  service_account = var.model_name
  role_arn        = aws_iam_role.vllm.arn
}
