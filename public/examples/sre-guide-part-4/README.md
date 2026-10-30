# Examples for "An SRE's guide to deploying Large Language Models, Part 4"

Everything from the post, as code. Names are placeholders: the cluster is `example-cluster`, the AWS account is
`111111111111`, the bucket is `example-models-bucket`. Every object that belongs to the model is called
`qwen38-27b-nvfp4`: that one string is the Deployment, the pod label, the served model name, the InferencePool and the
route match, and the route only works if it is the same everywhere.

| Folder | What it is |
|---|---|
| [`k8s/`](k8s) | The plain Kubernetes manifests, Helm values and Prometheus rules the post explains one by one |
| [`helm/llm-serving/`](helm/llm-serving) | A Helm chart that templates those manifests. Its default render equals the files in `k8s/` |
| [`terraform/`](terraform) | The AWS side: VPC, EKS, Karpenter's AWS resources, the weights bucket, Pod Identity, and the controller Helm releases |

The order is: `terraform apply` (the `region` variable is the only thing that changes between regions), upload the
weights to the bucket, install the llm-d router release, then `helm upgrade -i llm-serving`. The commands are in
section 5 of the post and in each folder's README.

Nothing in this folder has been applied to AWS or run on a GPU. Read the numbers that depend on hardware (startup
time, KV pool size, block size, NVMe throughput) off your own pods.

Pinned releases: vLLM v0.32.0, llm-d router v1.0.0 (chart `llm-d-router-gateway` v1.0.0), Gateway API Inference
Extension v1.6.2, Gateway API v1.6.1, Envoy Gateway v1.9.3, Envoy AI Gateway (Agent Router) v1.2.0, Karpenter v1.15.1,
Bottlerocket v1.68.0, KEDA v2.21.0, kube-prometheus-stack chart 92.16.1, Kubernetes 1.34 to 1.37. The Terraform module
needs Terraform 1.5.7 or newer.

## The raw manifests (`k8s/`)

| File | What it is | How it was checked |
|---|---|---|
| `nodepool.yaml` | Karpenter `NodePool` for a g7e GPU pool | server-side dry-run, strict, against the Karpenter v1.15.1 CRD; a misspelled field and an invalid policy value are rejected |
| `ec2nodeclass.yaml` | Karpenter `EC2NodeClass`: Bottlerocket NVIDIA AMI, RAID0 instance store | same |
| `vllm-deployment.yaml` | vLLM v0.32.0 serving Qwen3.8-27B NVFP4 with weights streamed from S3 | server-side dry-run, strict; the argument list also parses with vLLM v0.32.0's own parser |
| `vllm-deployment-tiered.yaml` | the same Deployment with a 16 GiB CPU tier and a local NVMe tier for the KV cache | server-side dry-run, strict; the `--kv-transfer-config` JSON has the shape that vLLM v0.32.0's `KVTransferConfig` and `TieringOffloadingSpec` classes accept |
| `kv-guard-configmap.yaml` | the script of the sidecar that keeps the NVMe tier under a byte budget | run in a container against ten test files: the oldest six were removed, the newest four kept |
| `epp-values.yaml` | Helm values for the llm-d router chart (endpoint picker, scorer weights 2/3/1) | `helm template` of the released chart, then a strict server-side dry-run of the output |
| `epp-metrics-reader.yaml` | a service account that may read the endpoint picker's authenticated `/metrics` (a `get` on that non-resource URL) | server-side dry-run, strict; in the local simulation the endpoint answered 401 without a token, 403 with the default token and 200 with this account's token |
| `gateway.yaml` | `GatewayClass`, `Gateway` and `EnvoyProxy` for Envoy Gateway | server-side dry-run, strict, against the Gateway API v1.6.1 and Envoy Gateway v1.9.3 CRDs |
| `aigatewayroute.yaml` | `AIGatewayRoute` from a model name to the `InferencePool` | server-side dry-run, strict, against the AI Gateway v1.2.0 CRDs |
| `scaledobject.yaml` | KEDA `ScaledObject`: queue and worst-pod KV triggers, plus a cron floor | server-side dry-run, strict, against the KEDA v2.21.0 CRD |
| `queries.rules.yml` | 30 PromQL recording rules for vLLM and the endpoint picker, including the KEDA trigger queries | `promtool check rules` (promtool 3.15.1) |
| `queries.test.yml` | unit tests for those rules with synthetic series that use the real metric names and labels | `promtool test rules`: all pass; a deliberately wrong expected value fails |

The server-side dry-runs ran on a throwaway local kind cluster that has only the CRDs of the pinned releases installed
(no controllers), so a pass means the object is valid for that release, not that it has been observed serving traffic.
To re-run one, install the CRDs of the release named in the table and run
`kubectl apply --dry-run=server --validate=strict -f <file>` with an explicit `--context`. Add a typo to a field name and
confirm the command rejects it: a check that cannot fail proves nothing.

## The Helm chart (`helm/llm-serving/`)

The chart renders the same objects as `k8s/`, with the values that change between clusters moved into `values.yaml`
(a JSON schema rejects bad values). Checks:

- `helm lint --strict` passes.
- `helm template` with the default values renders objects that are semantically equal to the files in `k8s/`, and with
  `--set tiering.enabled=true` it equals the tiered Deployment plus the guard ConfigMap.
- The full render passes the same strict server-side dry-run on the local kind cluster (CRDs only), and a misspelled
  field is rejected.

## The Terraform module (`terraform/`)

`terraform init -backend=false`, `terraform validate` and `terraform fmt -check -recursive` pass. No plan or apply has
been run: that needs an AWS account, so read the plan before you apply it. Chart versions of the controller releases were
checked with `helm show chart`.
