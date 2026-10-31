# Optional quota request. A new account in a new region cannot launch
# g7e until the On-Demand G and VT vCPU quota (L-DB2E81BA) is raised;
# gpu_quota_vcpus requests it here, 0 leaves the account default.

resource "aws_servicequotas_service_quota" "gpu_vcpus" {
  count = var.gpu_quota_vcpus > 0 ? 1 : 0

  service_code = "ec2"
  quota_code   = "L-DB2E81BA"
  value        = var.gpu_quota_vcpus
}
