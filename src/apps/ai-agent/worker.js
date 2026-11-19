// LLM worker: loads one model at a time on WebGPU and streams generated text back.
import {
  AutoTokenizer, AutoModelForCausalLM, TextStreamer, InterruptableStoppingCriteria, Tensor, DynamicCache, ones, env,
} from "./vendor/transformers.min.js";

import { MODELS } from "./models.js";
// Local runtime files; the worker itself is created only by the explicit Load model action.
const vendorUrl = file => new URL(`./vendor/${file}`, import.meta.url).href;
env.allowLocalModels = false;
env.backends.onnx.wasm.numThreads = 1;
env.backends.onnx.wasm.wasmPaths = { mjs: vendorUrl("ort-wasm-simd-threaded.asyncify.mjs") };
async function loadWasm() {
  const parts = await Promise.all(["parta", "partb"].map(async part => {
    const res = await fetch(vendorUrl(`ort-wasm-simd-threaded.asyncify.wasm.${part}`));
    if (!res.ok) throw new Error(`Could not fetch local ONNX Runtime: HTTP ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }));
  const joined = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) { joined.set(part, offset); offset += part.length; }
  env.backends.onnx.wasm.wasmBinary = joined.buffer;
}
const MAX_NEW_TOKENS = 384;
// Long prompts are prefilled in chunks: one pass over the whole prompt makes an attention buffer of about
// prompt² × 32 bytes, and ONNX Runtime WebGPU overflows ("SafeIntOnOverflow") once that passes 4 GiB
// (~11.6k tokens on LFM3). A chunk's buffer is only chunk × context × 32 bytes, so the chunk shrinks as the
// context grows to stay under that limit.
const PREFILL_CHUNK = 2048;
const MAX_ATTENTION_CELLS = 64e6; // chunk × context; 64M × 32 bytes = 2 GiB, half the overflow point

let tokenizer = null;
let model = null;
// The model state after the last generate(): the token ids it has seen and their cache. The next prompt
// usually starts with exactly those tokens (same chat plus a tool result), so only the new tail is prefilled.
// Qwen3.5 and LFM3 keep recurrent/conv state that cannot be rewound, so any other prompt starts over.
let cached = null;
const stopper = new InterruptableStoppingCriteria();

async function load(key) {
  const spec = MODELS[key];
  if (!spec) throw new Error(`Unknown model "${key}"`);
  await loadWasm();
  await dropCache();
  if (model) await model.dispose(); // free GPU memory before the next download
  model = tokenizer = null;

  const progress_callback = (p) => postMessage({ type: "progress", key, ...p });
  tokenizer = await AutoTokenizer.from_pretrained(spec.repo, { revision: spec.revision, progress_callback });
  model = await AutoModelForCausalLM.from_pretrained(spec.repo, {
    revision: spec.revision, dtype: spec.dtype, device: "webgpu", progress_callback,
  });
  // LFM3's graph requires `logits_to_keep`, which Transformers.js 4.3 neither fills nor lets through:
  // generate() only keeps kwargs named in forward_params. Whitelist it; generate() below supplies it.
  if (needsLogitsToKeep()) model.forward_params = [...model.forward_params, "logits_to_keep"];
  postMessage({ type: "ready", key });
}

const needsLogitsToKeep = () => Boolean(model?.sessions?.model?.inputNames.includes("logits_to_keep"));

const renderPrompt = (messages, tools) => tokenizer.apply_chat_template(messages, {
  tools, add_generation_prompt: true, enable_thinking: false, return_dict: true,
});

// Tokenizing only (no model run): milliseconds, used for the compaction budget.
function count({ id, messages, tools }) {
  if (!tokenizer) throw new Error("No model loaded");
  postMessage({ type: "counted", id, tokens: renderPrompt(messages, tools).input_ids.dims[1] });
}

async function dropCache() {
  const old = cached;
  cached = null;
  await old?.pkv.dispose();
}

// Inputs that make a forward pass compute logits for the last position only (the graphs name it differently).
function lastLogitOnly() {
  const names = (model.sessions.model ?? model.sessions.decoder_model_merged).inputNames;
  return {
    ...(names.includes("logits_to_keep") && { logits_to_keep: new Tensor("int64", [1n], [1]) }),
    ...(names.includes("num_logits_to_keep") && { num_logits_to_keep: new Tensor("int64", [1n], []) }),
  };
}

// With no tools offered (wrap-up and summary calls), small models still start a tool call or a think block from
// habit; banning the markers forces plain text.
const NO_TOOLS_BANNED = ["<tool_call>", "<think>"];
const bannedMarkers = () => NO_TOOLS_BANNED.map((t) => Array.from(tokenizer.encode(t, { add_special_tokens: false }), Number));

const pastName = (name) => name.replace(/^present_(ssm|conv|recurrent)/, "past_$1").replace(/^present/, "past_key_values");

/** Feed all but the last token of `ids` into the cache, reusing the previous turn's cache when it is a prefix. */
async function prefill(ids) {
  const reusable = cached && cached.ids.length < ids.length && cached.ids.every((t, i) => t === ids[i]);
  if (!reusable) await dropCache();
  let pkv = reusable ? cached.pkv : null;
  let done = reusable ? cached.ids.length : 0;
  cached = null; // the cache is mutated below; it is only valid again once generate() finishes
  const target = ids.length - 1; // generate() needs at least one new token to start from
  while (target - done > 0) {
    const chunk = Math.max(64, Math.min(PREFILL_CHUNK, Math.floor(MAX_ATTENTION_CELLS / target)));
    if (target - done <= chunk && done === 0) break; // short prompt: generate() prefills it in one go
    const end = Math.min(target, done + chunk);
    const out = await model.forward({
      input_ids: new Tensor("int64", ids.slice(done, end), [1, end - done]),
      attention_mask: ones([1, end]),
      past_key_values: pkv,
      ...lastLogitOnly(),
    });
    const fresh = {};
    for (const [name, tensor] of Object.entries(out)) {
      if (name.startsWith("present")) fresh[pastName(name)] = tensor;
      else if (tensor.location === "gpu-buffer") tensor.dispose();
    }
    if (pkv) pkv.update(fresh);
    else pkv = new DynamicCache(fresh);
    done = end;
  }
  return pkv;
}

async function generate({ id, messages, tools }) {
  if (!model) throw new Error("No model loaded");
  stopper.reset();
  const inputs = renderPrompt(messages, tools);
  const ids = Array.from(inputs.input_ids.data);
  let pkv;
  try {
    pkv = await prefill(ids);
  } catch (err) {
    await dropCache();
    throw err;
  }
  const streamer = new TextStreamer(tokenizer, {
    skip_prompt: true,
    skip_special_tokens: true,
    callback_function: (text) => postMessage({ type: "token", id, text }),
  });
  // Rides along in model_inputs on every decoding step; 1 = logits for the last token only.
  const extra = needsLogitsToKeep() ? { logits_to_keep: new Tensor("int64", [1n], [1]) } : {};
  let output;
  try {
    output = await model.generate({
      input_ids: inputs.input_ids,
      attention_mask: ones([1, ids.length]),
      ...(pkv && { past_key_values: pkv }),
      ...extra,
      ...(!tools?.length && { bad_words_ids: bannedMarkers() }),
      max_new_tokens: MAX_NEW_TOKENS, do_sample: false, streamer, stopping_criteria: stopper,
      return_dict_in_generate: true,
    });
  } catch (err) {
    await pkv?.dispose();
    throw err;
  }
  const { sequences, past_key_values } = output;
  // The last generated token was never fed back, so the cache covers one token less than `sequences`.
  cached = { ids: Array.from(sequences.data).slice(0, past_key_values.get_seq_length()), pkv: past_key_values };
  const [text] = tokenizer.batch_decode(sequences.slice(null, [ids.length, null]), { skip_special_tokens: true });
  postMessage({ type: "done", id, text });
}

// Serialize requests. The host terminates this worker on cancellation, including model download and prefill.
let queue = Promise.resolve();
self.onmessage = ({ data }) => {
  if (data.type === "stop") return stopper.interrupt();
  queue = queue.then(async () => {
    try {
      if (data.type === "load") await load(data.key);
      else if (data.type === "generate") await generate(data);
      else if (data.type === "count") count(data);
    } catch (err) {
      postMessage({ type: "error", id: data.id, key: data.key, message: String(err?.message ?? err) });
    }
  });
};
