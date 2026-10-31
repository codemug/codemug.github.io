{{/*
The one value holding the model name; the Deployment name, pod label, --served-model-name,
ServiceAccount, route match, ScaledObject target and every selector derive from it.
*/}}
{{- define "llm-serving.modelName" -}}
{{- .Values.model.name -}}
{{- end }}
