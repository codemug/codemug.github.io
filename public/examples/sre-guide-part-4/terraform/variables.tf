# The only value that changes when you re-apply this in another region.
variable "region" {
  description = "AWS region to deploy into"
  type        = string

  validation {
    condition     = can(regex("^[a-z]{2}(-[a-z]+)-[0-9]+$", var.region))
    error_message = "region must be an AWS region name such as us-east-1."
  }
}

variable "cluster_name" {
  description = "EKS cluster name; also the karpenter.sh/discovery tag value"
  type        = string
  default     = "example-cluster"
}

variable "kubernetes_version" {
  description = "EKS Kubernetes version (1.34 to 1.37 supported; 1.35 is the default)"
  type        = string
  default     = "1.35"
}

variable "vpc_cidr" {
  description = "VPC CIDR, must be a /16 (three /24 public and three /20 private subnets are cut from it)"
  type        = string
  default     = "10.0.0.0/16"
}

# Public API endpoint restriction. Narrow this before production.
variable "api_allowed_cidrs" {
  description = "CIDRs allowed to reach the public EKS API endpoint"
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

variable "model_name" {
  description = "Model name; one value feeds the S3 object prefix, the Pod Identity service account and the chart"
  type        = string
  default     = "qwen38-27b-nvfp4"
}

variable "model_bucket_name" {
  description = "S3 bucket that holds the model weights"
  type        = string
  default     = "example-models-bucket"
}

variable "model_s3_prefix" {
  description = "Object key prefix (trailing slash) of the weights inside the bucket"
  type        = string
  default     = "models/nvidia/Qwen3.8-27B-NVFP4/"
}

variable "system_instance_type" {
  description = "General-purpose instance type for the system node group that hosts the controllers"
  type        = string
  default     = "m5.xlarge"
}

variable "system_node_group_min_size" {
  description = "Minimum size of the system node group"
  type        = number
  default     = 2
}

variable "system_node_group_max_size" {
  description = "Maximum size of the system node group"
  type        = number
  default     = 4
}

variable "system_node_group_desired_size" {
  description = "Desired size of the system node group"
  type        = number
  default     = 2
}

variable "enable_nat_gateway" {
  description = "Create one NAT gateway so private subnets can egress for image pulls and S3 access"
  type        = bool
  default     = true
}

variable "gpu_quota_vcpus" {
  description = "If greater than 0, request this many On-Demand G and VT vCPUs (quota L-DB2E81BA); 0 leaves the account default"
  type        = number
  default     = 0
}

variable "tags" {
  description = "Tags applied to every resource"
  type        = map(string)
  default = {
    project     = "llm-serving"
    environment = "example"
  }
}
