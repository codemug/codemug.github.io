# Examples for "An SRE's guide to deploying Large Language Models, Part 4"

The manifests, Helm values and Prometheus rules used in the post. Names are placeholders: the cluster is
`example-cluster`, the AWS account is `111111111111`, the bucket is `example-models-bucket`. Everything is
namespaced `llm` unless the file says otherwise, and every object belonging to the model is called
`qwen38-27b-nvfp4`: that one string is the Deployment, the pod label, the served model name, the InferencePool
and the route match, and the route only works if it is the same everywhere.

**Nothing here was run on a GPU.** Each file was checked the way the table says, on a throwaway local kind
cluster that has only the CRDs of the pinned releases installed (no controllers), so a pass means the object is
valid for that release, not that it has been observed serving traffic. Read the numbers that depend on hardware
(startup time, KV pool size, block size, NVMe throughput) off your own pods.

Pinned releases, as of 2026-10-30: vLLM v0.32.0, llm-d router v1.0.0 (chart `llm-d-router-gateway` v1.0.0),
Gateway API Inference Extension v1.6.2, Gateway API v1.6.1, Envoy Gateway v1.9.3, Envoy AI Gateway
(Agent Router) v1.2.0, Karpenter v1.15.1, Bottlerocket v1.68.0, KEDA v2.21.0, Kubernetes 1.34 to 1.37.

| File | What it is | How it was checked |
|---|---|---|
| `nodepool.yaml` | Karpenter `NodePool` for a g7e GPU pool | server-side dry-run, strict, against the Karpenter v1.15.1 CRD; a misspelled field is rejected |
| `ec2nodeclass.yaml` | Karpenter `EC2NodeClass`: Bottlerocket NVIDIA AMI, RAID0 instance store | same |
| `vllm-deployment.yaml` | vLLM v0.32.0 serving Qwen3.8-27B NVFP4 with weights streamed from S3 | server-side dry-run, strict; the argument list also parses with vLLM v0.32.0's own parser |
| `vllm-deployment-tiered.yaml` | the same Deployment with a 16 GiB CPU tier and a local NVMe tier for the KV cache | server-side dry-run, strict; the `--kv-transfer-config` JSON has the shape that vLLM v0.32.0's `KVTransferConfig` and `TieringOffloadingSpec` classes accept |
| `kv-guard-configmap.yaml` | the script of the sidecar that keeps the NVMe tier under a byte budget | run in a container against ten test files: the oldest six were removed, the newest four kept |
| `epp-values.yaml` | Helm values for the llm-d router chart (endpoint picker, scorer weights 2/3/1) | `helm template` of the released chart, then a strict server-side dry-run of the output |
| `epp-metrics-reader.yaml` | a service account that may read the endpoint picker's authenticated `/metrics` (a `get` on that non-resource URL) | server-side dry-run, strict; in the local rehearsal the endpoint answered 401 without a token, 403 with the default token and 200 with this account's token |
| `gateway.yaml` | `GatewayClass`, `Gateway` and `EnvoyProxy` for Envoy Gateway | server-side dry-run, strict, against the Gateway API v1.6.1 and Envoy Gateway v1.9.3 CRDs |
| `aigatewayroute.yaml` | `AIGatewayRoute` from a model name to the `InferencePool` | server-side dry-run, strict, against the AI Gateway v1.2.0 CRDs |
| `scaledobject.yaml` | KEDA `ScaledObject`: queue and worst-pod KV triggers, plus a cron floor | server-side dry-run, strict, against the KEDA v2.21.0 CRD |
| `queries.rules.yml` | 30 PromQL recording rules for vLLM and the endpoint picker, including the KEDA trigger queries | `promtool check rules` (promtool 3.15.1) |
| `queries.test.yml` | unit tests for those rules with synthetic series that use the real metric names and labels | `promtool test rules`: all pass; a deliberately wrong expected value fails |

To re-run a check, create a kind cluster, install the CRDs of the release named in the table, and run
`kubectl apply --dry-run=server --validate=strict -f <file>` with an explicit `--context`. Add a typo to a field
name and confirm the command rejects it: a check that cannot fail proves nothing.
