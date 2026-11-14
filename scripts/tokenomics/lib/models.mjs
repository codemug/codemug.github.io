// models.json from seeds/models_focus.json.
// Order and field names are fixed here; values come from the seed only.
import { readSeed, fail } from "./read.mjs";

// Required output order.
const ORDER = [
  "qwen3.8-27b",
  "qwen3.8-flash-next",
  "kimi-k3.1-pro",
  "deepseek-v4.1-flash",
  "muse-spark-open",
  "nemotron-3.5-super-vl",
  "gemma-4-31b",
];

const BIT_KEYS = ["4", "8", "16"];

// Map one seed row to the models.json record.
function toModel(x) {
  if (!x.m1_inputs || !x.checkpoints_by_bits || !x.kv_bytes_per_token) {
    fail([`model ${x.id}: seed row missing m1_inputs, checkpoints_by_bits or kv_bytes_per_token`]);
  }
  const mi = x.m1_inputs;
  const mla = mi.h_kv === "mla";
  const checkpoints = {};
  for (const b of BIT_KEYS) {
    const v = x.checkpoints_by_bits[b];
    if (!v) fail([`model ${x.id}: no ${b}-bit checkpoint in seed`]);
    checkpoints[b] = {
      repo: v.repo ?? null,
      format: v.format ?? null,
      sizeGb: v.size_gb,
      bitsPerWeight: v.bits_per_weight_all ?? null,
      readGbNonrouted: v.nonrouted_read_gb,
      readGbRouted: v.routed_gb,
      estimated: v.repo == null,
      note: v.kind ?? null,
    };
  }
  if (!Array.isArray(x.source_urls) || !x.captured) {
    fail([`model ${x.id}: seed row missing source_urls or captured`]);
  }
  return {
    id: x.id,
    name: x.name,
    hfRepo: x.hf_repo ?? null,
    license: x.license ?? null,
    contextMax: x.context_max,
    P: mi.P,
    A: mi.A,
    E: mi.E,
    k: mi.k,
    L: mi.L,
    kvFp8: mi.kv_fp8,
    kvBf16: x.kv_bytes_per_token.bf16,
    S: mi.S,
    kvHeads: mla ? 1 : mi.h_kv,
    mla,
    dpa: mi.dpa,
    checkpoints,
    sourceUrls: x.source_urls,
    captured: x.captured,
  };
}

// Build all seven model records in contract order.
export function buildModels() {
  const seeds = readSeed("models_focus.json");
  if (!Array.isArray(seeds)) fail(["models_focus.json: expected a JSON array"]);
  const byId = new Map();
  for (const s of seeds) byId.set(s.id, s);
  const missing = ORDER.filter((id) => !byId.has(id));
  if (missing.length) fail([`models_focus.json: missing model ids: ${missing.join(", ")}`]);
  return ORDER.map((id) => toModel(byId.get(id)));
}
