# The controller Helm releases, in the install order that leaves every
# component Ready: each controller needs the CRDs it reads to exist
# first, so the releases chain with depends_on. The GIE CRDs ship as a
# small local chart (charts/gie-crds/) because the release manifest is
# plain YAML, not a Helm chart.

resource "helm_release" "gie_crds" {
  name      = "gie-crds"
  chart     = "charts/gie-crds"
  version   = "1.6.2"
  namespace = "kube-system"

  depends_on = [module.eks]
}

# Gateway API and Envoy Gateway CRDs.
resource "helm_release" "gateway_crds" {
  name       = "eg-crds"
  repository = "oci://docker.io/envoyproxy"
  chart      = "gateway-crds-helm"
  version    = "v1.9.3"
  namespace  = "kube-system"

  values = [yamlencode({
    crds = {
      gatewayAPI   = { enabled = true }
      envoyGateway = { enabled = true }
    }
  })]

  depends_on = [helm_release.gie_crds]
}

# AI Gateway CRDs.
resource "helm_release" "ai_gateway_crds" {
  name             = "aieg-crd"
  repository       = "oci://docker.io/envoyproxy"
  chart            = "ai-gateway-crds-helm"
  version          = "v1.2.0"
  namespace        = "envoy-ai-gateway-system"
  create_namespace = true

  depends_on = [helm_release.gateway_crds]
}

# The AI Gateway controller. The ClusterRole it ships lets Envoy
# Gateway read InferencePool objects, which is why it is installed
# before the gateway below.
resource "helm_release" "ai_gateway" {
  name             = "aieg"
  repository       = "oci://docker.io/envoyproxy"
  chart            = "ai-gateway-helm"
  version          = "v1.2.0"
  namespace        = "envoy-ai-gateway-system"
  create_namespace = true

  depends_on = [helm_release.ai_gateway_crds]
}

# Envoy Gateway with the AI Gateway values files (vendored in values/,
# source and tag in each file's header). The CRDs are installed by the
# release above, so the chart's own copy is disabled.
resource "helm_release" "envoy_gateway" {
  name             = "eg"
  repository       = "oci://docker.io/envoyproxy"
  chart            = "gateway-helm"
  version          = "v1.9.3"
  namespace        = "envoy-gateway-system"
  create_namespace = true

  values = [
    file("${path.module}/values/envoy-gateway-values.yaml"),
    file("${path.module}/values/envoy-gateway-values-addon.yaml"),
    yamlencode({ crds = { enabled = false } }),
  ]

  depends_on = [helm_release.ai_gateway]
}

# KEDA scales the vLLM pods from Prometheus metrics.
resource "helm_release" "keda" {
  name             = "keda"
  repository       = "https://kedacore.github.io/charts"
  chart            = "keda"
  version          = "2.21.0"
  namespace        = "keda"
  create_namespace = true

  depends_on = [module.eks]
}

# Prometheus stack. The release name makes the Prometheus Service
# kube-prometheus-stack-prometheus.monitoring.svc, which the
# ScaledObject queries. The SelectorNilUsesHelmValues flags are false
# so the stack's own label selectors do not filter out the
# ServiceMonitors, PodMonitors and PrometheusRules this cluster uses.
resource "helm_release" "prometheus_stack" {
  name       = "kube-prometheus-stack"
  repository = "https://prometheus-community.github.io/helm-charts"
  chart      = "kube-prometheus-stack"
  version    = "92.16.1"
  namespace  = "monitoring"
  # The chart no longer creates its namespace (92.16.1 has no
  # createNamespaces value), so this release creates it.
  create_namespace = true

  values = [yamlencode({
    prometheusOperator = {
      serviceMonitorSelectorNilUsesHelmValues = false
      podMonitorSelectorNilUsesHelmValues     = false
      ruleSelectorNilUsesHelmValues           = false
    }
  })]

  depends_on = [module.eks]
}
