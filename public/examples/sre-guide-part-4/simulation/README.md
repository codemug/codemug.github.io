# Run the routing simulation yourself

In part 5, section 1 we put a gateway and an endpoint picker in front of the model servers. Here we do the same on a laptop, so you can watch it work. We start a small Kubernetes cluster, install the real gateway and the real picker, and put three fake model servers behind them. Then we send traffic and count which server answered each request.

## What this simulates, and what it does not

The real parts are the ones from the post: Envoy Gateway v1.9.3, Envoy AI Gateway v1.2.0, the Gateway API Inference Extension v1.6.2 CRDs, and the llm-d router v1.0.0 chart with the same `epp-values.yaml` as the post (queue scorer 2, KV cache scorer 3, prefix cache scorer 1).

The fake parts are the model servers. Each one is a short Python script, `fake_vllm.py`. It answers `/v1/chat/completions` after a pretend prefill and a pretend decode. It exposes the vLLM metric names that the picker reads: waiting requests, running requests, KV cache usage and cache config. It has four request slots and a small prefix cache, so a repeated prompt is cheaper and the picker has something to learn. It puts its pod name in the `x-served-by` response header, which is how we count.

So the simulation shows routing: which pod gets which request, and when. It does not show model speed. There is no GPU and no model here, so every latency in the tables is the fake's. Do not read tokens per second or time to first token out of it.

One more difference from the post. `gateway.yaml` asks the AWS Load Balancer Controller for a network load balancer. kind has no such controller, so `gateway-kind.yaml` is the same file with a plain ClusterIP Service for Envoy. We reach the gateway with `kubectl port-forward`.

## Prerequisites

We need docker or podman, kind, kubectl, helm, python 3 and curl, plus internet access to pull images and charts. The scripts use only the Python standard library.

We tested with kind v0.29.0 on podman, kubectl v1.33.1, helm v4.1.4 and Python 3.14, on a container VM with 4 CPUs and 14 GiB of memory. We did not try a smaller VM.

If kind runs on podman, set this first:

```sh
export KIND_EXPERIMENTAL_PROVIDER=podman
```

Every command below names its cluster explicitly, with `--context kind-p4-sim` for kubectl and `--kube-context kind-p4-sim` for helm. We do this on purpose. Your kubeconfig may point at a real cluster, and a command that forgets the context would hit it. Keep the flags when you copy.

If helm stops with an error about a missing credential helper while it pulls an OCI chart, give it an empty registry config and try again:

```sh
mkdir -p /tmp/helm-docker && echo '{}' > /tmp/helm-docker/config.json && export DOCKER_CONFIG=/tmp/helm-docker
```

## The files

| file | what it is |
|---|---|
| `kind-config.yaml` | one node, Kubernetes v1.33.1 |
| `envoy-gateway-values.yaml`, `envoy-gateway-values-addon.yaml` | the Envoy Gateway values from the platform install, unchanged |
| `fake_vllm.py`, `fake-vllm.yaml` | the fake model server and the Deployment of three replicas that runs it |
| `epp-values.yaml` | the post's picker values, unchanged |
| `gateway-kind.yaml` | the post's `gateway.yaml` with a ClusterIP Service for Envoy |
| `aigatewayroute.yaml` | the post's route, unchanged |
| `epp-metrics-reader.yaml` | the post's service account for reading the picker's metrics, unchanged |
| `traffic.py` | sends the traffic and prints which pod answered |
| `picks.py` | prints the scores the picker gave each pod, from its log |

Run every command from this folder.

## Step 1. Create the cluster

```sh
kind create cluster --name p4-sim --config kind-config.yaml
```

The node image is pinned to Kubernetes v1.33.1. Keep it at 1.33 or newer: one Envoy Gateway CRD uses a CEL function that Kubernetes 1.31 does not have, and it fails to install there.

## Step 2. Install the gateway stack

The order matters, the same as in the platform install. Gateway API Inference Extension CRDs first, then the Gateway API and Envoy Gateway CRDs, then the AI Gateway chart, and Envoy Gateway last. Envoy Gateway never becomes ready if it goes in before the AI Gateway chart, because the cluster role that lets it read InferencePool objects ships with that chart.

```sh
kubectl --context kind-p4-sim apply -f https://github.com/kubernetes-sigs/gateway-api-inference-extension/releases/download/v1.6.2/manifests.yaml

helm template eg-crds oci://docker.io/envoyproxy/gateway-crds-helm --version v1.9.3 \
  --set crds.gatewayAPI.enabled=true --set crds.envoyGateway.enabled=true \
  | kubectl --context kind-p4-sim apply --server-side --force-conflicts -f -

helm --kube-context kind-p4-sim upgrade -i aieg-crd oci://docker.io/envoyproxy/ai-gateway-crds-helm --version v1.2.0 \
  --namespace envoy-ai-gateway-system --create-namespace

helm --kube-context kind-p4-sim upgrade -i aieg oci://docker.io/envoyproxy/ai-gateway-helm --version v1.2.0 \
  --namespace envoy-ai-gateway-system

helm --kube-context kind-p4-sim upgrade -i eg oci://docker.io/envoyproxy/gateway-helm --version v1.9.3 \
  --namespace envoy-gateway-system --create-namespace --set crds.enabled=false \
  -f envoy-gateway-values.yaml -f envoy-gateway-values-addon.yaml

kubectl --context kind-p4-sim wait --timeout=3m -n envoy-ai-gateway-system deployment/ai-gateway-controller --for=condition=Available
kubectl --context kind-p4-sim wait --timeout=3m -n envoy-gateway-system deployment/envoy-gateway --for=condition=Available
```

## Step 3. Start the fake model servers

The script goes into a ConfigMap and a stock `python:3.12-slim` image runs it. Nothing to build. The pods carry the label `app=qwen38-27b-nvfp4` and the container port `http` (8000), the same label and port as the real Deployment, so the picker finds them the same way.

```sh
kubectl --context kind-p4-sim create namespace llm
kubectl --context kind-p4-sim create configmap fake-vllm -n llm --from-file=fake_vllm.py
kubectl --context kind-p4-sim apply -f fake-vllm.yaml
kubectl --context kind-p4-sim rollout status -n llm deployment/qwen38-27b-nvfp4 --timeout=5m
```

## Step 4. Install the picker

The release name `qwen38-27b-nvfp4` matters. The chart builds the InferencePool and the picker Service from it, and the route in step 5 refers to those names.

```sh
helm --kube-context kind-p4-sim upgrade -i qwen38-27b-nvfp4 oci://ghcr.io/llm-d/charts/llm-d-router-gateway --version v1.0.0 \
  --namespace llm -f epp-values.yaml --wait --timeout 5m
```

## Step 5. Create the gateway and the route

```sh
kubectl --context kind-p4-sim apply -f gateway-kind.yaml
kubectl --context kind-p4-sim wait --timeout=3m -n ai-gateway gateway/llm-gateway --for=condition=Programmed
kubectl --context kind-p4-sim apply -f aigatewayroute.yaml
kubectl --context kind-p4-sim wait --timeout=2m -n llm aigatewayroute/qwen38-27b-nvfp4 --for=condition=Accepted
```

Once the first route exists, the AI Gateway controller replaces the Envoy pod with one that carries its sidecar. Wait until `kubectl --context kind-p4-sim get pods -n ai-gateway` shows a single pod that is `3/3 Running`. The first pod, `2/2`, goes away on its own.

## Step 6. Open the gateway and send one request

Open a second terminal and leave this running. It forwards local port 8080 to the Envoy Service. If the Envoy pod is ever replaced, run it again.

```sh
kubectl --context kind-p4-sim port-forward -n ai-gateway $(kubectl --context kind-p4-sim get svc -n ai-gateway -l gateway.envoyproxy.io/owning-gateway-name=llm-gateway -o name) 8080:80
```

Back in the first terminal:

```sh
curl -s -i http://127.0.0.1:8080/v1/chat/completions -H 'Content-Type: application/json' \
  -d '{"model":"qwen38-27b-nvfp4","messages":[{"role":"user","content":"ping"}],"max_tokens":8}'
```

We should see `HTTP/1.1 200 OK` and a header `x-served-by` with the name of one fake pod. That header travelled from the pod, through Envoy, to us. The request found its pod because the AI Gateway matched the model name, asked the picker for an endpoint, and Envoy sent it there.

## The experiments

Each experiment is one command. `traffic.py` prints a table of how many requests each pod answered, with the pod's five character name suffix as the column. A pod that answered nothing has no column. The shared prompt is new on every start of the script, so every start begins cold. The exact split changes from run to run. The pattern is what to look for.

### Experiment 1. The same long prompt, one request at a time

```sh
python3 traffic.py shared
```

Thirty requests, one after the other, all with the same 3,000 character system prompt. Only the last line changes. The picker keeps a rough memory of which pod has seen which prompt prefix, and the prefix cache scorer rewards a pod that has the prefix. What to look for: one pod answers all 30. Which pod it is does not matter, the first pick is arbitrary.

### Experiment 2. Different prompts, one request at a time

```sh
python3 traffic.py unique
```

Thirty requests, one after the other, each with its own long prompt. There is no prefix to follow, so the prefix scorer has no vote, and the queue and KV scorers see three idle pods. What to look for: all three pods answer, and none of them takes much more than half. The split is not exactly even.

The script waits 100 ms between two requests, like a client that reads an answer before it asks again. Try `python3 traffic.py --pause 0 unique` to remove the wait. Now the next request arrives a few milliseconds after the last answer, while the picker still holds numbers that say the last pod is busy. It avoids that pod, and the requests go back and forth between two pods. In five runs with `--pause 0` the least used pod answered 3 to 7 of the 30. With the pause, in 14 runs, no pod answered fewer than 5. The picker's numbers are always a little old. Experiment 3 depends on the same fact.

### Experiment 3. Twenty different prompts at the same instant

```sh
python3 traffic.py burst
python3 traffic.py burst-busy
```

Twenty requests with different prompts are released at one instant. The picker scores each request on the numbers it scraped from the pods a few tens of milliseconds ago. It does not count the requests it has just sent, so all twenty see the same numbers.

Run it twice, because what the picker does depends on what the numbers say. `burst` sends the twenty to an idle pool. Every pod looks the same, so the picker hands the requests out in turns and the split is close to even. `burst-busy` sends the same twenty while two background senders keep two pods busy. Now one pod looks free and two look busy. What to look for: the burst lands on the pods that looked free a moment ago and skips the busy ones. The requests of the background senders show in their own row, `background`.

### Experiment 4. Twelve senders on the shared prompt for 30 seconds

```sh
python3 traffic.py shared sustained
```

We run `shared` first in the same start so that one pod already holds the prompt. Then twelve senders send the shared prompt back to back for 30 seconds. What to look for: in the first second every request goes to the warm pod, because the numbers are still the same for all of them. Then its queue grows. A pod with a queue loses up to 2 points on the queue scorer, and the prefix reward is only 1 point, so the other pods start to win. They take requests and learn the prefix. After a second or two all three pods share the load. The second table in the output shows the first six seconds.

### All five in one go

```sh
python3 traffic.py
```

This takes about two minutes and prints one table for all of it. The last row, `all sent`, counts every request the script sent, including the `background` ones.

## Read the picker's own counters

The picker counts what it did. Its metrics port needs a bearer token, so we create a service account that may read it. Then we compare the picker's counts with what `traffic.py` printed and with each pod's own counter.

First reset, so that every counter starts at zero. This restarts the fake pods and the picker, and they forget their caches:

```sh
kubectl --context kind-p4-sim rollout restart -n llm deployment/qwen38-27b-nvfp4 deployment/qwen38-27b-nvfp4-epp
kubectl --context kind-p4-sim rollout status -n llm deployment/qwen38-27b-nvfp4 --timeout=3m
kubectl --context kind-p4-sim rollout status -n llm deployment/qwen38-27b-nvfp4-epp --timeout=3m
```

Run everything once:

```sh
python3 traffic.py
```

Create the service account, then open the picker's metrics port in a third terminal:

```sh
kubectl --context kind-p4-sim create namespace monitoring
kubectl --context kind-p4-sim apply -f epp-metrics-reader.yaml
```

```sh
kubectl --context kind-p4-sim port-forward -n llm svc/qwen38-27b-nvfp4-epp 9090:9090
```

Read the counter:

```sh
TOKEN=$(kubectl --context kind-p4-sim create token metrics-reader -n monitoring)
curl -s -H "Authorization: Bearer $TOKEN" http://127.0.0.1:9090/metrics | grep '^llm_d_epp_scheduler_attempts_total'
```

Without a token the picker answers 401. That is the chart's default, and it is why the service account exists.

Each pod also counts its own requests. We reach it through the API server:

```sh
for p in $(kubectl --context kind-p4-sim get pods -n llm -l app=qwen38-27b-nvfp4 -o name | cut -d/ -f2); do
  kubectl --context kind-p4-sim get --raw "/api/v1/namespaces/llm/pods/$p:8000/proxy/_stats"; echo
done
```

What to look for: the picker's `scheduler_attempts_total` per pod, the pod's own `served` and the `all sent` row of `traffic.py` agree. The table in the next section shows ours.

## See the scores the picker saw

The picker can log the score it gave every pod for every request. This turns the burst from a story into evidence. Raise its log level, which restarts the picker, and run the busy burst:

```sh
helm --kube-context kind-p4-sim upgrade qwen38-27b-nvfp4 oci://ghcr.io/llm-d/charts/llm-d-router-gateway --version v1.0.0 \
  --namespace llm -f epp-values.yaml --set router.epp.flags.v=5 --wait --timeout 5m
```

```sh
python3 traffic.py burst-busy
kubectl --context kind-p4-sim logs -n llm deploy/qwen38-27b-nvfp4-epp --since=2m | python3 picks.py > picks.txt
```

Open `picks.txt`. It has one line per request the picker scored: the time, then for each pod its score, the queue and running numbers the picker had scraped, and how old those numbers were. The pod with the highest score gets the request. Pods with the same score take turns.

## The numbers I saw

Setup: kind v0.29.0 on podman, Kubernetes v1.33.1, one node, three fake pods, picker started from `epp-values.yaml` as shipped (the picker's log said `queue-scorer: 2, kv-cache-utilization-scorer: 3, prefix-cache-scorer: 1`). Pod names are shortened to five characters.

The numbers I saw were these, from one run of `python3 traffic.py` straight after the reset in the counters section:

| experiment | requests | 8j692 | vjjdm | w4ktp | top share | not 200 | median s | max s |
|---|---|---|---|---|---|---|---|---|
| shared | 30 | 0 | 30 | 0 | 100% | 0 | 0.45 | 0.65 |
| unique | 30 | 6 | 10 | 14 | 46% | 0 | 0.62 | 0.63 |
| burst | 20 | 6 | 6 | 8 | 40% | 0 | 0.66 | 1.26 |
| burst-busy | 20 | 11 | 9 | 0 | 55% | 0 | 1.22 | 1.84 |
| background | 28 | 9 | 7 | 12 | 42% | 0 | 0.61 | 0.64 |
| sustained | 597 | 198 | 203 | 196 | 34% | 0 | 0.48 | 1.50 |
| all sent | 725 | 230 | 265 | 230 | | | | |

The seconds are the fake's, not a model's. In the same run the first six seconds of `sustained` looked like this (requests started per second):

| second | 8j692 | vjjdm | w4ktp |
|---|---|---|---|
| 0 to 1 | 0 | 12 | 4 |
| 1 to 2 | 13 | 7 | 4 |
| 2 to 3 | 0 | 8 | 7 |
| 3 to 4 | 11 | 3 | 9 |
| 4 to 5 | 4 | 9 | 6 |
| 5 to 6 | 9 | 5 | 13 |

The warm pod took 12 requests in the first second. After that all three pods took requests. The per second numbers are lumpy because the senders move in waves. The totals over 30 seconds are what is even.

The three counts agreed for every pod. The picker's `llm_d_epp_scheduler_attempts_total` was 230, 265 and 230. The pods' own `served` was 230, 265 and 230. The `all sent` row says 230, 265 and 230.

The exact split changes from run to run, and the burst changes most. This is what repeated runs gave (each run's counts sorted from the busiest pod to the quietest):

| experiment | runs | what we saw |
|---|---|---|
| shared | 4 | 30/0/0 every time, not always on the same pod |
| unique, with the 100 ms pause | 14 | the busiest pod 11 to 15 requests, the quietest 5 to 9. For example 14/10/6, 13/12/5, 15/8/7 |
| unique, `--pause 0` | 5 | 12/11/7, 13/11/6, 14/12/4, 14/13/3, 12/11/7 |
| burst, idle pool | 11 | always spread over three pods, the busiest 7 to 10, the quietest 3 to 6. For example 8/6/6, 10/7/3, 9/6/5, 7/7/6 |
| burst-busy | 9 | all 20 on one pod in 4 runs, on two pods in 4 runs, on three pods in 1 run (10/6/4) |
| sustained | 3 | 225/221/213, 227/225/219, 203/198/196 |

In each of the three `sustained` runs the warm pod took 12 requests in the first second.

Here is the picker's log for one `burst-busy` run (the table of that run said `8j692` 20). These are three of the twenty lines. They all fall inside 32 ms. The numbers behind them were scraped 13 to 46 ms earlier, and they never changed during the burst. `8j692` looked idle, the other two had a request running, and all twenty went to `8j692`:

```text
12:27:48.722   8j692 score 4.94 queue 0 running 0 age  13 ms   vjjdm score 4.70 queue 0 running 1 age  14 ms   w4ktp score 4.70 queue 0 running 1 age  14 ms
12:27:48.728   8j692 score 4.94 queue 0 running 0 age  19 ms   vjjdm score 4.70 queue 0 running 1 age  20 ms   w4ktp score 4.70 queue 0 running 1 age  20 ms
12:27:48.754   8j692 score 4.94 queue 0 running 0 age  45 ms   vjjdm score 4.70 queue 0 running 1 age  46 ms   w4ktp score 4.70 queue 0 running 1 age  46 ms
```

On an idle pool all three pods look the same to the picker. Pods with equal scores take turns in the picker's code, and that is the even split we saw. We never saw an idle burst herd onto one pod in 11 runs.

For comparison, my earlier run of this simulation used other fake servers and the router at its chart default profile (queue 2, KV 2, prefix 3). It gave 30/0/0 for shared, 11/11/8 for unique, 15/5/0 and 0/13/7 for the idle burst and 245/238/254 for sustained. The shared and sustained results match ours. The idle burst did not: on this kit it spread.

## Clean up

```sh
kind delete cluster --name p4-sim
```

## If something fails

Helm says `error getting credentials`. Use the empty registry config from the prerequisites.

One CRD fails with `undeclared reference to 'format'`. The node image is older than Kubernetes 1.33. Delete the cluster and create it again from `kind-config.yaml`.

`kubectl wait` for the Gateway runs into its timeout. Run `kubectl --context kind-p4-sim describe gateway -n ai-gateway llm-gateway`. If it says `Programmed=False` with the reason `AddressNotAssigned`, the Envoy Service is a LoadBalancer that waits for an address kind cannot give. Use `gateway-kind.yaml`, not the post's `gateway.yaml`.

`curl` says connection refused on port 8080, or the forward stopped. The forward ends when the Envoy pod behind it is replaced, for example in the minute after the first route appears. Run the port-forward command from step 6 again.

A request answers 503 with the header `x-llm-d-request-dropped-reason: rejected-no-endpoints`. The picker sees no ready pod. The fake pods may still be starting. Wait a few seconds and try again.
