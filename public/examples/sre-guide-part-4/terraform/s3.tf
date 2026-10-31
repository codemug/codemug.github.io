# The weights bucket: versioned, encrypted, public access blocked.
# The vLLM pods read it through the Pod Identity role in pod_identity.tf.
# The name includes the region so the same configuration can be applied
# in another region without renaming.

locals {
  models_bucket_name = coalesce(var.model_bucket_name, "${var.cluster_name}-models-${var.region}")
}

resource "aws_s3_bucket" "models" {
  bucket = local.models_bucket_name
}

resource "aws_s3_bucket_versioning" "models" {
  bucket = aws_s3_bucket.models.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "models" {
  bucket = aws_s3_bucket.models.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "models" {
  bucket = aws_s3_bucket.models.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
