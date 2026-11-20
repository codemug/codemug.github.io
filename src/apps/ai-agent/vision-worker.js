// AI-7/AI-8 vision worker: its own worker on the vendored Transformers.js 4.3.2 (separate from
// the chat model worker) for two on-demand engine families, each loaded on first use:
//  - OCR: onnx-community/Florence-2-base-ft (MIT), pinned revision, the card's exact classes
//    (Florence2ForConditionalGeneration + AutoProcessor), the <OCR> task. Loaded on WASM q8
//    (onnx/*_quantized.onnx, about 262 MB): this ORT build's WebGPU EP rejects the Florence
//    graph for every dtype (verified: q4f16 ~213 MB and fp32 both fail with a subgraph-output
//    graph error), and WebGPU activity in the worker breaks later session creation, so no
//    in-worker webgpu→wasm fallback. There is no automatic fp32 fall-back (about 1.09 GB):
//    if the q8 load fails, the error is reported and the next request retries the load.
//  - Background removal via the 'background-removal' pipeline: the bundle maps the modnet and
//    birefnet model types to a generic segmentation class, so no model-specific export is needed.
//    Default: Xenova/modnet (Apache-2.0), pinned revision, fp32 (about 24.7 MB), always on
//    WASM: the q8 (int8) file produces an all-zero matte on every device in this bundle
//    (measured), and the WebGPU EP is otherwise flaky in this ORT build. Optional higher
//    quality: onnx-community/BiRefNet_lite-ONNX (MIT), pinned revision, fp16 (about
//    109 MB), WebGPU only (ORT WASM is fp32-only).
// Device: WebGPU when an adapter answers (navigator.gpu AND requestAdapter()), otherwise WASM
// (MODNet and Florence are pinned to WASM regardless — see MODELS); stated in the ready message.
// Terminating the worker cancels a download or an in-flight run.
// Message protocol matches ModelClient: load -> progress/ready, ocr/bgbm -> done/error.
import { HF_PINNED } from './hf-pin.js'; // also installs the fetch pinning (must precede the bundle import)
import { env, RawImage, Florence2ForConditionalGeneration, AutoProcessor, pipeline } from './vendor/transformers.min.js';

const MODELS = {
  'florence-ocr': {
    repo: 'onnx-community/Florence-2-base-ft',
    revision: HF_PINNED['onnx-community/Florence-2-base-ft'],
    // q8 on WASM directly: this ORT build's WebGPU EP rejects the Florence graph for every
    // dtype (verified: q4f16 and fp32 both fail with "subgraph output (logits) is an outer scope
    // value"), and WebGPU activity in this worker also breaks later session creation, so an
    // in-worker cross-device fallback is unreliable. WASM q8 loads fine (verified, 32.6 s).
    dtype: 'q8', // onnx/*_quantized.onnx, about 262 MB; a failed load is reported, no fp32 (about 1.09 GB) retry
  },
  'modnet-bgbm': {
    repo: 'Xenova/modnet',
    revision: HF_PINNED['Xenova/modnet'],
    // Always WASM fp32 (measured): the q8 (int8) weights produce an ALL-ZERO matte on every
    // device in this bundle — verified in-page and via the worker, on wasm and webgpu alike —
    // so the 6.3 MB quantised file is unusable. fp32 (about 24.7 MB, the card's documented
    // dtype) mattes correctly; WASM keeps it device-independent (the WebGPU EP is flaky in
    // this ORT build), and 24.7 MB is small enough to be the default on every device.
    device: 'wasm',
    dtype: 'fp32', // onnx/model.onnx, about 24.7 MB
  },
  'birefnet-bgbm': {
    repo: 'onnx-community/BiRefNet_lite-ONNX',
    revision: HF_PINNED['onnx-community/BiRefNet_lite-ONNX'],
    dtype: 'fp16', // onnx/model_fp16.onnx, about 109 MB; WebGPU only
  },
};
const BGBM_TASK = 'background-removal';
const OCR_TASK = '<OCR>';
const OCR_MAX_NEW_TOKENS = 100; // the card's example value

const vendorUrl = (file) => new URL(`./vendor/${file}`, import.meta.url).href;
env.allowLocalModels = false;
env.backends.onnx.wasm.numThreads = 1;
env.backends.onnx.wasm.wasmPaths = { mjs: vendorUrl('ort-wasm-simd-threaded.asyncify.mjs') };

async function loadWasm() {
  if (env.backends.onnx.wasm.wasmBinary) return; // idempotent: the local .mjs ORT loader needs these bytes for ANY backend init (webgpu included)
  const parts = await Promise.all(['parta', 'partb'].map(async (part) => {
    const res = await fetch(vendorUrl(`ort-wasm-simd-threaded.asyncify.wasm.${part}`));
    if (!res.ok) throw new Error(`Could not fetch local ONNX Runtime: HTTP ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }));
  const joined = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) { joined.set(part, offset); offset += part.length; }
  env.backends.onnx.wasm.wasmBinary = joined.buffer;
}

// navigator.gpu alone is not enough (headless Chrome and some laptops expose it without an
// adapter): WebGPU only counts when an adapter actually answers.
async function gpuAdapter() {
  if (typeof navigator === 'undefined' || !navigator.gpu) return null;
  try { return await navigator.gpu.requestAdapter(); } catch { return null; }
}
async function pickDevice() {
  return (await gpuAdapter()) ? 'webgpu' : 'wasm';
}

const state = {}; // key -> { model|pipe, processor?, device, dtype, bytes } (promise while loading)

async function loadModel(key) {
  const spec = MODELS[key];
  if (!spec) throw new Error(`Unknown vision model "${key}".`);
  const device = await pickDevice();
  if (key === 'birefnet-bgbm') {
    // fp16 weights need the WebGPU shader-f16 feature — absent on SwiftShader/headless and on
    // some GPUs (ORT would fail with "The device (webgpu) does not support fp16").
    const adapter = await gpuAdapter();
    if (!adapter?.features.has('shader-f16')) throw new Error('BiRefNet Lite needs a WebGPU with the shader-f16 feature (fp16 weights); use MODNet instead.');
  }
  await loadWasm(); // always, before any session: a missing wasmBinary makes ORT fetch a remote .wasm (HTML here)
  const perFile = new Map();
  const progress = (p) => {
    if (p.file && typeof p.loaded === 'number') perFile.set(p.file, Math.max(perFile.get(p.file) ?? 0, p.loaded));
    postMessage({ type: 'progress', status: p.status, file: p.file, loaded: p.loaded, total: p.total, progress: p.progress });
  };
  // Load plans: Florence and MODNet are pinned to WASM in this runtime (see MODELS comments).
  // Florence has no fp32 last resort (about 1.09 GB): if the q8 load fails, the error is reported.
  const plans = key === 'florence-ocr'
    ? [['wasm', 'q8']]
    : [[spec.device ?? device, spec.dtype]];
  const make = async (dev, dtype) => {
    const common = { revision: spec.revision, dtype, device: dev, progress_callback: progress };
    if (key === 'florence-ocr') {
      // The card's exact usage at the pinned revision.
      const [model, processor] = await Promise.all([
        Florence2ForConditionalGeneration.from_pretrained(spec.repo, common),
        AutoProcessor.from_pretrained(spec.repo, { revision: spec.revision }),
      ]);
      return { model, processor, device: dev, dtype };
    }
    return { pipe: await pipeline(BGBM_TASK, spec.repo, common), device: dev, dtype };
  };
  let built;
  for (let i = 0; i < plans.length; i++) {
    const [dev, dtype] = plans[i];
    try {
      built = await make(dev, dtype);
      break;
    } catch (err) {
      if (i === plans.length - 1) throw err;
      const [nextDev, nextDtype] = plans[i + 1];
      postMessage({ type: 'progress', status: 'note', file: 'fallback', loaded: 0, total: 0, progress: 0, message: `${dtype} on ${dev} failed (${String(err?.message ?? err).slice(0, 200)}); trying ${nextDtype} on ${nextDev}${nextDtype === 'fp32' ? ' — last resort, a much larger download' : ''}.` });
    }
  }
  built.bytes = [...perFile.values()].reduce((s, b) => s + b, 0);
  return built;
}

async function ensure(key) {
  // A failed load is NOT cached: a cached rejection would make the model unusable until the worker
  // is terminated. The error is reported and the next request retries the load.
  if (!state[key]) state[key] = loadModel(key).catch((err) => { delete state[key]; throw err; });
  return state[key];
}

const blobOf = (image) => new Blob([new Uint8Array(image)], { type: 'image/png' });

async function runOcr({ id, image }) {
  const st = await ensure('florence-ocr');
  const raw = await RawImage.fromBlob(blobOf(image));
  const prompts = st.processor.construct_prompts(OCR_TASK);
  const inputs = await st.processor(raw, prompts);
  const generated = await st.model.generate({ ...inputs, max_new_tokens: OCR_MAX_NEW_TOKENS });
  const text = st.processor.batch_decode(generated, { skip_special_tokens: false })[0];
  const result = st.processor.post_process_generation(text, OCR_TASK, raw.size);
  postMessage({ type: 'done', id, text: typeof result[OCR_TASK] === 'string' ? result[OCR_TASK] : JSON.stringify(result) });
}

async function runBgbm({ id, image, model = 'modnet' }) {
  const st = await ensure(model === 'birefnet' ? 'birefnet-bgbm' : 'modnet-bgbm');
  const raw = await RawImage.fromBlob(blobOf(image));
  // The background-removal pipeline applies the matte itself: original pixels with the matte as
  // the alpha channel (putAlpha), resampled to the original size — so the output IS the PNG.
  const out = await st.pipe(raw);
  postMessage({ type: 'done', id, png: await out.toBlob(), width: out.width, height: out.height });
}

// Serialize requests; the host terminates this worker to cancel a download or a run.
let queue = Promise.resolve();
self.onmessage = ({ data }) => {
  queue = queue.then(async () => {
    try {
      if (data.type === 'load') {
        const st = await ensure(data.key);
        postMessage({ type: 'ready', vision: true, model: data.key, device: st.device, dtype: st.dtype, bytes: st.bytes });
      } else if (data.type === 'ocr') await runOcr(data);
      else if (data.type === 'bgbm') await runBgbm(data);
    } catch (err) {
      postMessage({ type: 'error', id: data.id ?? null, message: String(err?.message ?? err) });
    }
  });
};
