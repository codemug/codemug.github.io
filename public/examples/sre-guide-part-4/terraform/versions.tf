terraform {
  # The eks module used by this configuration requires at least this version.
  required_version = ">= 1.5.7"

  required_providers {
    # Pinned to a minor so a fresh init elsewhere resolves the same
    # provider versions you planned with.
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.71"
    }
    helm = {
      source  = "hashicorp/helm"
      version = "~> 3.3"
    }
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 3.4"
    }
  }
}
