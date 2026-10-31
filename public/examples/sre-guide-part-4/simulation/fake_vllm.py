"""A fake vLLM model server for the routing simulation. It is NOT a model: no tokens are generated and nothing runs on a GPU.

What it imitates, because the endpoint picker reads exactly this:
  * vLLM metric names. The picker scrapes vllm:num_requests_waiting, vllm:num_requests_running,
    vllm:kv_cache_usage_perc and vllm:cache_config_info from /metrics.
  * A fixed number of request slots (MAX_RUNNING). A request holds a slot for a fake prefill plus a fake decode.
    Requests beyond the slots wait, and the waiting and running gauges show it.
  * A small prefix cache. The prompt is cut into 256 character blocks (about 64 tokens), hashed cumulatively and kept in
    an LRU. Leading blocks that are already cached make the fake prefill shorter, like a real prefix cache does.
  * A toy KV cache gauge: 0.02 + 0.08 * running, capped at 0.99. It follows the running requests only. In vLLM the
    cached blocks of finished requests count as free, so an idle pod with a full prefix cache still reports a low usage.
  * The response header x-served-by, with the pod name. The traffic script reads it to count requests per pod.

The delays are fake, so latency numbers from this server say nothing about a real model. Only the routing is real.
Standard library only.
"""
import hashlib
import json
import os
import threading
import time
from collections import OrderedDict
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

NAME = os.environ.get("NAME", "fake")                        # the pod name (set from the downward API)
MODEL = os.environ.get("MODEL", "example-model")             # label on the metrics, and the model name in replies
MAX_RUNNING = int(os.environ.get("MAX_RUNNING", "4"))        # request slots
DECODE_MS = int(os.environ.get("DECODE_MS", "400"))          # fake decode time, holds the slot
PREFILL_MS_PER_BLOCK = float(os.environ.get("PREFILL_MS_PER_BLOCK", "15"))
CACHE_BLOCKS = int(os.environ.get("CACHE_BLOCKS", "400"))    # prefix cache size, in blocks
BLOCK_CHARS = 256                                            # about 64 tokens at 4 characters per token
COMPLETION_TOKENS = 8
BLOCK_SIZE = "16"                                            # advertised in vllm:cache_config_info
NUM_GPU_BLOCKS = "20000"

lock = threading.Lock()
slots = threading.Semaphore(MAX_RUNNING)
cache = OrderedDict()   # cumulative block hash -> True, oldest first
S = {"running": 0, "waiting": 0, "served": 0, "pc_queries": 0, "pc_hits": 0}


def kv_usage():
    return min(0.99, 0.02 + 0.08 * S["running"])


def metrics_text():
    lab = f'engine="0",model_name="{MODEL}"'
    with lock:
        rows = [
            ("vllm:num_requests_running", "gauge", "Number of requests in model execution batches.", S["running"]),
            ("vllm:num_requests_waiting", "gauge", "Number of requests waiting to be processed.", S["waiting"]),
            ("vllm:kv_cache_usage_perc", "gauge", "KV-cache usage. 1 means 100 percent usage.", kv_usage()),
            ("vllm:prefix_cache_queries_total", "counter", "Prefix cache queries, in tokens.", S["pc_queries"]),
            ("vllm:prefix_cache_hits_total", "counter", "Prefix cache hits, in tokens.", S["pc_hits"]),
        ]
        out = []
        for name, kind, doc, val in rows:
            out += [f"# HELP {name} {doc}", f"# TYPE {name} {kind}", f"{name}{{{lab}}} {val}"]
        out += ["# HELP vllm:cache_config_info Information of the LLMEngine CacheConfig",
                "# TYPE vllm:cache_config_info gauge",
                f'vllm:cache_config_info{{engine="0",block_size="{BLOCK_SIZE}",num_gpu_blocks="{NUM_GPU_BLOCKS}"}} 1']
    return "\n".join(out) + "\n"


def blocks_of(text):
    hashes, h = [], hashlib.blake2b(digest_size=8)
    for i in range(0, len(text), BLOCK_CHARS):
        h.update(text[i:i + BLOCK_CHARS].encode())
        hashes.append(h.copy().hexdigest())
    return hashes


def serve_chat(body):
    req = json.loads(body or b"{}")
    text = "".join(str(m.get("content", "")) for m in req.get("messages", [])) or str(req.get("prompt", ""))
    hashes = blocks_of(text)
    prompt_tokens = max(1, len(text) // 4)
    with lock:
        S["waiting"] += 1
    slots.acquire()
    with lock:
        S["waiting"] -= 1
        S["running"] += 1
        hit = 0
        for h in hashes:                      # leading blocks only, like a real prefix cache
            if h not in cache:
                break
            hit += 1
        cached_tokens = min(prompt_tokens, hit * (BLOCK_CHARS // 4))
    time.sleep(0.005 + (len(hashes) - hit) * PREFILL_MS_PER_BLOCK / 1000.0)   # fake prefill: cached blocks are free
    time.sleep(DECODE_MS / 1000.0)                                            # fake decode
    with lock:
        for h in hashes:
            cache[h] = True
            cache.move_to_end(h)
        while len(cache) > CACHE_BLOCKS:
            cache.popitem(last=False)
        S["running"] -= 1
        S["served"] += 1
        S["pc_queries"] += prompt_tokens
        S["pc_hits"] += cached_tokens
    slots.release()
    reply = {"id": f"fake-{NAME}", "object": "chat.completion", "model": MODEL,
             "choices": [{"index": 0, "finish_reason": "stop",
                          "message": {"role": "assistant", "content": f"hello from {NAME}"}}],
             "usage": {"prompt_tokens": prompt_tokens, "completion_tokens": COMPLETION_TOKENS,
                       "total_tokens": prompt_tokens + COMPLETION_TOKENS}}
    return json.dumps(reply).encode(), {"x-fake-cached-blocks": f"{hit}/{len(hashes)}"}


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):
        pass

    def _send(self, code, body, ctype="application/json", extra=None):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("x-served-by", NAME)
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = self.path.split("?")[0]
        if path == "/metrics":
            self._send(200, metrics_text().encode(), "text/plain; version=0.0.4")
        elif path == "/_stats":                                    # the pod's own request counter, for cross-checks
            with lock:
                self._send(200, json.dumps({"name": NAME, **S, "cached_blocks": len(cache)}).encode())
        elif path == "/health":
            self._send(200, b"{}")
        else:
            self._send(404, b'{"error":"not found"}')

    def read_body(self):
        # The gateway sends the request body to the pod with "Transfer-Encoding: chunked" and no Content-Length. A server
        # that only honours Content-Length reads an empty body and breaks the kept-alive connection (HTTP 502 at the client).
        if self.headers.get("Transfer-Encoding", "").lower() == "chunked":
            parts = []
            while True:
                size = int(self.rfile.readline().split(b";")[0].strip() or b"0", 16)
                if size == 0:
                    while self.rfile.readline() not in (b"\r\n", b"\n", b""):   # trailers, then the final blank line
                        pass
                    return b"".join(parts)
                parts.append(self.rfile.read(size))
                self.rfile.read(2)                                              # CRLF after each chunk
        n = int(self.headers.get("Content-Length", "0") or 0)
        return self.rfile.read(n) if n else b""

    def do_POST(self):
        body = self.read_body()
        if self.path.split("?")[0] in ("/v1/chat/completions", "/v1/completions"):
            out, hdr = serve_chat(body)
            self._send(200, out, extra=hdr)
        else:
            self._send(404, b'{"error":"not found"}')


class Server(ThreadingHTTPServer):
    request_queue_size = 128    # the default backlog of 5 is too small for a burst of simultaneous connections


if __name__ == "__main__":
    Server(("0.0.0.0", 8000), Handler).serve_forever()
