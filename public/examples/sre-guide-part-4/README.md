# Examples for "An SRE's guide to deploying Large Language Models", parts 4 and 5

Everything from [part 4](https://usmanshahid.is-a.dev/blog/sre-guide-deploying-llms-part-4/) and [part 5](https://usmanshahid.is-a.dev/blog/sre-guide-deploying-llms-part-5/), as code. Part 4 deploys the model (`terraform/`, the model layer of `helm/llm-serving/`, `k8s/nodepool.yaml`, `k8s/ec2nodeclass.yaml` and `k8s/vllm-deployment.yaml`). Part 5 adds routing, observability, autoscaling and tiering (the rest of `k8s/`, `platform/` and `simulation/`, and the other layers of the chart). Names are placeholders: the cluster is `example-cluster`, the AWS account is
`111111111111`, the weights bucket is `example-cluster-models-us-east-1` (Terraform builds it as
`<cluster>-models-<region>`, and S3 bucket names are global, so give your cluster a name that is yours). Every object
that belongs to the model is called `qwen38-27b-nvfp4`: that one string is the Deployment, the pod label, the served
model name, the InferencePool and the route match, and the route only works if it is the same everywhere.

| Folder | What it is |
|---|---|
| [`terraform/`](terraform) | The AWS side: VPC, EKS, the system node group, Karpenter's AWS resources and controller, the AWS Load Balancer Controller, the weights bucket, Pod Identity |
| [`helm/llm-serving/`](helm/llm-serving) | The Helm chart for everything specific to the model: GPU nodes, vLLM, the gateway objects and route, the metrics objects and rules, the autoscaler |
| [`k8s/`](k8s) | The plain Kubernetes manifests, Helm values and Prometheus rules that the post explains one by one. The chart's default render equals them |
| [`platform/`](platform) | The values files for the community charts (Envoy Gateway, Prometheus) and the install order |
| [`simulation/`](simulation) | A local, GPU-free kit that runs the real gateway and picker in front of fake model servers |

The order is in the posts: `terraform apply` (the `region` variable is the only thing that changes between regions),
upload the weights to the bucket, install the chart with only the model switched on and test the pod, install the gateway
stack and the llm-d router, turn routing on and test through the gateway, install Prometheus and switch the observability
layer on, then KEDA and the autoscaler. `platform/README.md` lists every install command in order.

Read the numbers that depend on hardware (startup time, KV pool size, block size, NVMe throughput) off your own pods.

Pinned releases: vLLM v0.32.0, llm-d router v1.0.0 (chart `llm-d-router-gateway` v1.0.0), Gateway API Inference
Extension v1.6.2, Gateway API v1.6.1, Envoy Gateway v1.9.3, Envoy AI Gateway (Agent Router) v1.2.0, Karpenter v1.15.1,
Bottlerocket v1.68.0, KEDA v2.21.0, kube-prometheus-stack chart 92.16.1, Kubernetes 1.36. The Terraform module needs
Terraform 1.5.7 or newer.

## The raw manifests (`k8s/`)

| File | What it is | How it was checked |
|---|---|---|
| `nodepool.yaml` | Karpenter `NodePool` for a g7e GPU pool | server-side dry-run, strict, against the Karpenter v1.15.1 CRD; a misspelled field and an invalid policy value are rejected |
| `ec2nodeclass.yaml` | Karpenter `EC2NodeClass`: Bottlerocket NVIDIA AMI, RAID0 instance store | same |
| `vllm-deployment.yaml` | vLLM v0.32.0 serving Qwen3.8-27B NVFP4 with weights streamed from S3 | server-side dry-run, strict; the argument list also parses with vLLM v0.32.0's own parser |
| `vllm-deployment-tiered.yaml` | the same Deployment with a 16 GiB CPU tier and a local NVMe tier for the KV cache | server-side dry-run, strict; the `--kv-transfer-config` JSON has the shape that vLLM v0.32.0's `KVTransferConfig` and `TieringOffloadingSpec` classes accept |
| `kv-guard-configmap.yaml` | the script of the sidecar that keeps the NVMe tier under a byte budget | run in a container against ten test files: the oldest six were removed, the newest four kept |
| `epp-values.yaml` | Helm values for the llm-d router chart (endpoint picker, scorer weights 2/3/1) | `helm template` of the released chart, then a strict server-side dry-run of the output |
| `epp-values-precise.yaml` | optional: the same values with precise prefix-cache routing (vLLM publishes KV events, the picker follows them) | `helm template` of the released chart, and the real picker image run with it against stand-in pods that publish KV events |
| `epp-metrics-reader.yaml` | a service account that may read the endpoint picker's authenticated `/metrics` (a `get` on that non-resource URL) | server-side dry-run, strict; in the local simulation the endpoint answered 401 without a token, 403 with the default token and 200 with this account's token |
| `podmonitors.yaml` | a `PodMonitor` for the vLLM pods and a `ServiceMonitor` for the picker | server-side dry-run, strict, against the Prometheus Operator CRDs |
| `gateway.yaml` | `GatewayClass`, `Gateway` and `EnvoyProxy` for Envoy Gateway, with an internal NLB through the AWS Load Balancer Controller | server-side dry-run, strict, against the Gateway API v1.6.1 and Envoy Gateway v1.9.3 CRDs |
| `aigatewayroute.yaml` | `AIGatewayRoute` from a model name to the `InferencePool` | server-side dry-run, strict, against the AI Gateway v1.2.0 CRDs |
| `scaledobject.yaml` | KEDA `ScaledObject` with five triggers: KV forecast, worst-pod KV, batch saturation, sustained queue, time to first token | server-side dry-run, strict, against the KEDA v2.21.0 CRD |
| `queries.rules.yml` | 34 PromQL recording rules for vLLM and the endpoint picker, including the autoscaler's queries | `promtool check rules` (promtool 3.15.1) |
| `queries.test.yml` | unit tests for those rules with synthetic series that use the real metric names and labels | `promtool test rules`: all pass; a deliberately wrong expected value fails |

The server-side dry-runs ran on a throwaway local kind cluster that has only the CRDs of the pinned releases installed
(no controllers), so a pass means the object is valid for that release. To re-run one, install the CRDs of the release
named in the table and run `kubectl apply --dry-run=server --validate=strict -f <file>` with an explicit `--context`. Add
a typo to a field name and confirm the command rejects it: a check that cannot fail proves nothing.

## The Helm chart (`helm/llm-serving/`)

The chart renders the same objects as `k8s/`, with the values that change between clusters moved into `values.yaml`
(a JSON schema rejects bad values). Each layer has a switch: the model, `routing`, `autoscaling` and `observability`.
Checks:

- `helm lint --strict` passes.
- `helm template` with the default values renders objects that are semantically equal to the files in `k8s/`, and with
  `--set tiering.enabled=true` it equals the tiered Deployment plus the guard ConfigMap.
- The full render passes the same strict server-side dry-run on the local kind cluster (CRDs only), and a misspelled
  field is rejected.

## The Terraform module (`terraform/`)

`terraform init -backend=false`, `terraform validate` and `terraform fmt -check -recursive` pass. Read the plan before you
apply it: the Kubernetes API endpoint is public by default, and the system node group takes the newest Bottlerocket
image. Chart versions of the controller releases were checked with `helm show chart`.

## The simulation (`simulation/`)

A local kind cluster with the real Envoy Gateway, Envoy AI Gateway and llm-d router, and three fake model servers that
imitate vLLM's API and metric names. It tells you about the gateway and the picker, not about vLLM or a GPU. The steps
and the traffic script are in `simulation/README.md`.
