// AI-3 embedding worker: Xenova/all-MiniLM-L6-v2 (q8 ONNX, about 23 MB) on the WASM
// device, pinned revision, in its own worker — the chat model worker stays untouched.
// Message protocol matches ModelClient: load → progress/ready, embed → done/error.
import { pipeline, env } from "./vendor/transformers.min.js";

const MODEL = "Xenova/all-MiniLM-L6-v2";
const REVISION = "751bff37182d3f1213fa05d7196b954e230abad9"; // sha from the Hugging Face model API, verified
const vendorUrl = (file) => new URL(`./vendor/${file}`, import.meta.url).href;
env.allowLocalModels = false;
env.backends.onnx.wasm.numThreads = 1;
env.backends.onnx.wasm.wasmPaths = { mjs: vendorUrl("ort-wasm-simd-threaded.asyncify.mjs") };
let extractor = null;

async function loadWasm() {
  const parts = await Promise.all(["parta", "partb"].map(async (part) => {
    const res = await fetch(vendorUrl(`ort-wasm-simd-threaded.asyncify.wasm.${part}`));
    if (!res.ok) throw new Error(`Could not fetch local ONNX Runtime: HTTP ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }));
  const joined = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) { joined.set(part, offset); offset += part.length; }
  env.backends.onnx.wasm.wasmBinary = joined.buffer;
}

async function load() {
  await loadWasm();
  extractor = await pipeline("feature-extraction", MODEL, {
    revision: REVISION,
    // q8 resolves to onnx/model_quantized.onnx (dtype→file map in the vendored Transformers.js).
    dtype: "q8",
    device: "wasm",
    progress_callback: (p) => postMessage({ type: "progress", ...p }),
  });
  postMessage({ type: "ready" });
}

async function embed({ id, texts }) {
  if (!extractor) throw new Error("No embedding model loaded.");
  const out = await extractor(texts, { pooling: "mean", normalize: true });
  const vectors = out.tolist().map((v) => Float32Array.from(v));
  postMessage({ type: "done", id, vectors });
}

// Serialize requests; the host terminates this worker to cancel a download or an indexing run.
let queue = Promise.resolve();
self.onmessage = ({ data }) => {
  queue = queue.then(async () => {
    try {
      if (data.type === "load") await load();
      else if (data.type === "embed") await embed(data);
    } catch (err) {
      postMessage({ type: "error", id: data.id, message: String(err?.message ?? err) });
    }
  });
};
