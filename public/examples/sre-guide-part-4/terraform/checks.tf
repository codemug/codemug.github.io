# Fails the plan in a region that does not offer g7e.2xlarge, the GPU
# instance the NodePool requests. The IaC form of "does this machine
# exist in this region".

data "aws_ec2_instance_type_offerings" "g7e" {
  location_type = "availability-zone"

  filter {
    name   = "instance-type"
    values = ["g7e.2xlarge"]
  }

  lifecycle {
    postcondition {
      condition     = length(self.locations) > 0
      error_message = "g7e.2xlarge is not offered in ${var.region}. Pick a region from the list in section 1."
    }
  }
}
