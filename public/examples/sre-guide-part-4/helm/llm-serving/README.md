# llm-serving Helm chart

Installs one streamed vLLM model on an EKS + Karpenter GPU pool:

- Karpenter `NodePool` + `EC2NodeClass` (`g7e`): Bottlerocket nodes, local NVMe formatted as RAID0 ephemeral storage
- vLLM `Deployment` + `ServiceAccount`: weights streamed from S3 (`runai_streamer`), one replica per GPU node
- optional KV tiering (`tiering.enabled=true`): CPU-RAM + NVMe offload, the `kv-guard` sidecar and its ConfigMap
- Envoy AI Gateway: `GatewayClass`, `EnvoyProxy`, `Gateway`, `AIGatewayRoute` (namespace `ai-gateway`)
- KEDA `ScaledObject`: autoscaling on queue depth and KV cache utilization
- Prometheus recording rules + the EPP `metrics-reader` ServiceAccount/ClusterRole/ClusterRoleBinding/Secret (namespace `monitoring`)

The vLLM pod reads the S3 weights prefix through an IAM role bound by an EKS Pod Identity
association created on the Terraform side, so the chart has nothing to annotate.

## Install

```sh
terraform -chdir=../../terraform output -raw chart_values_yaml > terraform-values.yaml
helm upgrade -i llm-serving . --namespace llm --create-namespace -f terraform-values.yaml
```

The values file supplies `karpenter.nodeRole`, `karpenter.discoveryTag`, `model.s3Uri`, `model.awsRegion`
and `observability.createNamespace` (false, because the Prometheus release already created the namespace);
everything else keeps its default.

## Value blocks

| Block | What it sets |
|---|---|
| `model` | the model name (every derived name), the S3 weights URL, the bucket region |
| `karpenter` | the `g7e` NodePool + EC2NodeClass and the AWS-side inputs |
| `vllm` | serve image and flags (context length, KV dtype, memory, spec decoding) |
| `tiering` | KV offload: CPU GiB, NVMe GiB, guard budget (off by default) |
| `routing` | the AI gateway objects and their namespace; also creates the `ai-gateway` namespace |
| `autoscaling` | ScaledObject bounds and thresholds (replicas, queue/KV thresholds, cron floor) |
| `observability` | Prometheus rules + metrics-reader and their namespace; set `observability.createNamespace=false` when the namespace already exists, as with the Terraform install |

## Enabling KV tiering

```sh
helm upgrade -i llm-serving . --namespace llm -f terraform-values.yaml --set tiering.enabled=true
```
