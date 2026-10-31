# Cluster add-ons (Helm)

Terraform stops at the cluster, Karpenter and the AWS Load Balancer Controller. Everything else that runs in Kubernetes is
a plain Helm install of an upstream chart, and this folder holds the values files. The post introduces each install at the
point where it is needed. In order:

```sh
# Prometheus (part 5, section 2): creates the monitoring namespace
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm upgrade -i kube-prometheus-stack prometheus-community/kube-prometheus-stack --version 92.16.1 \
  --namespace monitoring --create-namespace -f kube-prometheus-stack-values.yaml

# Gateway API Inference Extension CRDs, then the gateway stack, in this order (part 5, section 1)
kubectl apply -f https://github.com/kubernetes-sigs/gateway-api-inference-extension/releases/download/v1.6.2/manifests.yaml
helm template eg-crds oci://docker.io/envoyproxy/gateway-crds-helm --version v1.9.3 \
  --set crds.gatewayAPI.enabled=true --set crds.envoyGateway.enabled=true | kubectl apply --server-side --force-conflicts -f -
helm upgrade -i aieg-crd oci://docker.io/envoyproxy/ai-gateway-crds-helm --version v1.2.0 \
  --namespace envoy-ai-gateway-system --create-namespace
helm upgrade -i aieg oci://docker.io/envoyproxy/ai-gateway-helm --version v1.2.0 \
  --namespace envoy-ai-gateway-system
helm upgrade -i eg oci://docker.io/envoyproxy/gateway-helm --version v1.9.3 \
  --namespace envoy-gateway-system --create-namespace --set crds.enabled=false \
  -f envoy-gateway-values.yaml -f envoy-gateway-values-addon.yaml

# KEDA (part 5, section 3)
helm repo add kedacore https://kedacore.github.io/charts
helm upgrade -i keda kedacore/keda --version 2.21.0 --namespace keda --create-namespace
```

`envoy-gateway-values.yaml` and `envoy-gateway-values-addon.yaml` are copies of the Envoy AI Gateway v1.2.0 files
(`manifests/envoy-gateway-values.yaml` and `examples/inference-pool/envoy-gateway-values-addon.yaml`), vendored so that the
commands above work from this folder. The order of the gateway stack matters: Envoy Gateway with the InferencePool add-on
never becomes Ready if it is installed before the AI Gateway chart, because the cluster role that lets it read
`InferencePool` objects ships with that chart.
