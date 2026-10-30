locals {
  # The values the llm-serving Helm chart needs.
  chart_values = {
    karpenter = {
      nodeRole     = module.karpenter.node_iam_role_name
      discoveryTag = var.cluster_name
    }
    model = {
      s3Uri     = "s3://${var.model_bucket_name}/${var.model_s3_prefix}"
      awsRegion = var.region
    }
  }
}

output "cluster_name" {
  description = "EKS cluster name"
  value       = var.cluster_name
}

output "region" {
  description = "AWS region"
  value       = var.region
}

output "node_role_name" {
  description = "Karpenter node IAM role name (the EC2NodeClass role)"
  value       = module.karpenter.node_iam_role_name
}

output "models_bucket_name" {
  description = "S3 bucket with the model weights"
  value       = aws_s3_bucket.models.id
}

output "chart_values" {
  description = "Values the llm-serving Helm chart needs"
  value       = local.chart_values
}

output "chart_values_yaml" {
  description = "chart_values as YAML: `terraform output -raw chart_values_yaml > terraform-values.yaml`"
  value       = yamlencode(local.chart_values)
}
