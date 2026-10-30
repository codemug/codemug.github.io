# llm-serving Terraform

Takes an empty AWS account to a cluster ready for the `llm-serving` Helm
chart. Terraform owns everything that lives in AWS (VPC, EKS, the
Karpenter AWS side, the weights bucket, the pod identity) and installs
the controller Helm releases (Karpenter, Envoy Gateway + AI Gateway,
KEDA, Prometheus stack). The model itself is the `helm/llm-serving`
chart, which this configuration prepares for: the output
`chart_values_yaml` renders the values that chart needs. Requires
Terraform >= 1.5.7 (the eks module's requirement).

## Commands (in order)

These commands are written down, not run: the configuration was checked
with `terraform init`, `terraform validate` and `terraform fmt` only,
and was never applied.

```sh
# 1. install modules and providers
terraform -chdir=terraform init

# 2. review what will happen (needs credentials for the target region)
terraform -chdir=terraform plan -var region=us-east-1

# 3. create the VPC, cluster, Karpenter AWS side, S3 bucket and Helm releases
terraform -chdir=terraform apply -var region=us-east-1

# 4. point kubectl at the cluster
aws eks update-kubeconfig --name example-cluster --region us-east-1

# 5. upload the weights (the bucket is created empty)
aws s3 sync ./models/nvidia/Qwen3.8-27B-NVFP4 s3://example-models-bucket/models/nvidia/Qwen3.8-27B-NVFP4

# 6. render the values the model chart needs
terraform -chdir=terraform output -raw chart_values_yaml > terraform-values.yaml

# 7. install the model
helm upgrade -i llm-serving ./helm/llm-serving -f terraform-values.yaml
```

## Deploy in another region

Change only `region` (for example `-var region=eu-central-1`) and
re-run the same steps. What does not carry over to the new region: the
bucket contents (sync the weights again), the `gpu_quota_vcpus` request
(quotas are per region), and any capacity reservations (per region and
per availability zone). If the bucket name is already taken in your
account (S3 names are global), set a different `model_bucket_name` for
the second region.
