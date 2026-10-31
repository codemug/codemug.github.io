# llm-serving Helm chart

Installs one streamed vLLM model on an EKS + Karpenter GPU pool:

- Karpenter `NodePool` + `EC2NodeClass` (`g7e`): Bottlerocket nodes, local NVMe formatted as RAID0 ephemeral storage
- vLLM `Deployment` + `ServiceAccount`: weights streamed from S3 (`runai_streamer`), one replica per GPU node
- optional KV tiering (`tiering.enabled=true`): CPU-RAM + NVMe offload, the `kv-guard` sidecar and its ConfigMap
- Envoy AI Gateway: `GatewayClass`, `EnvoyProxy`, `Gateway`, `AIGatewayRoute` (namespace `ai-gateway`)
- KEDA `ScaledObject`: five triggers (KV forecast, worst-pod KV cache, batch saturation, sustained queue, time to first token)
- Observability: a `PodMonitor` for the vLLM pods, a `ServiceMonitor` for the picker, 34 Prometheus recording rules, and the EPP `metrics-reader` ServiceAccount/ClusterRole/ClusterRoleBinding/Secret (namespace `monitoring`)

The vLLM pod reads the S3 weights prefix through an IAM role bound by an EKS Pod Identity
association created on the Terraform side, so the chart has nothing to annotate.

## Install

```sh
terraform -chdir=../../terraform output -raw chart_values_yaml > terraform-values.yaml
helm upgrade -i llm-serving . --namespace llm --create-namespace -f terraform-values.yaml
```

The values file supplies `karpenter.nodeRole`, `karpenter.discoveryTag`, `model.s3Uri`, `model.awsRegion`;
everything else keeps its default.

## Value blocks

| Block | What it sets |
|---|---|
| `model` | the model name (every derived name), the S3 weights URL, the bucket region |
| `karpenter` | the `g7e` NodePool + EC2NodeClass and the AWS-side inputs |
| `vllm` | serve image and flags (context length, KV dtype, memory, spec decoding), and the optional KV events switch for precise prefix routing |
| `tiering` | KV offload: CPU GiB, NVMe GiB, guard budget (off by default) |
| `routing` | the AI gateway objects and their namespace; the NLB scheme of the gateway Service; also creates the `ai-gateway` namespace |
| `autoscaling` | ScaledObject bounds and thresholds (replicas, early-warning triggers) |
| `observability` | Prometheus rules + metrics-reader + Pod/ServiceMonitors and their namespace (the Prometheus install creates it) |

## Enabling KV tiering

```sh
helm upgrade -i llm-serving . --namespace llm -f terraform-values.yaml --set tiering.enabled=true
```
