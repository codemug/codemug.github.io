// gpus.json from seeds/gpus.json, seeds/gpu_precision.json, seeds/constants.json
// and seeds/gpu_overrides.json (overrides win).
import { readSeed, fail } from "./read.mjs";

// Output ids in page order, mapped to the exact seed names.
const GPU_MAP = {
  rtx6000pro: "RTX PRO 6000 Blackwell Server Edition",
  l40s: "L40S",
  h100: "H100 SXM",
  h200: "H200 SXM",
  b200: "B200 (HGX)",
  b300: "B300 (HGX)",
  gb200: "GB200 (NVL72, per GPU)",
  mi300x: "MI300X",
  mi355x: "MI355X",
};

// M1 constants row per id: rtx6000pro and l40s use the global row,
// b300 and gb200 use the b200 row, the rest use their own row.
const GLOBAL_ROW_IDS = new Set(["rtx6000pro", "l40s"]);
const ROW_ALIAS = { gb200: "b200", b300: "b200" };
const CALIBRATED = new Set(["h100", "h200", "b200", "mi300x", "mi355x"]);
const BAND_CAL = { low: 0.7, high: 1.4 };
const BAND_EXTRAP = { low: 0.5, high: 2.0 };
// Clarification 5: mi300x stays calibrated but takes the wider band (its
// in-sample p90 throughput error is 65 percent, beyond x0.7 to x1.4).
const BAND_WIDE = new Set(["mi300x"]);

// Index an array of seed rows by one string field, failing on duplicates.
function byName(rows, field) {
  const m = new Map();
  for (const r of rows) {
    if (m.has(r[field])) fail([`seed ${field}: duplicate name ${r[field]}`]);
    m.set(r[field], r);
  }
  return m;
}

// Group gpu_overrides.json rows by seed gpu name: { name -> { field: value } }.
function overridesByGpu(rows) {
  const m = new Map();
  for (const r of rows) {
    const f = m.get(r.gpu) ?? {};
    f[r.field] = r.value;
    m.set(r.gpu, f);
  }
  return m;
}

function toGpu(gid, name, prec, spec, cons, ov) {
  const o = ov.get(name) ?? {};
  const row = GLOBAL_ROW_IDS.has(gid) ? cons.global : cons.perGpu[ROW_ALIAS[gid] ?? gid] ?? cons.global;
  const cal = CALIBRATED.has(gid);
  const bits = {};
  for (const [b, v] of Object.entries(prec.bit_widths)) {
    bits[b] = { mode: v.mode, peakTflops: o[`${v.peak_key}_dense_tflops`] ?? v.peak_tflops };
  }
  const g = {
    id: gid,
    name,
    memGb: o.memory_gb ?? spec.memory_gb ?? prec.memory_gb,
    bwTBs: o.bandwidth_tbps ?? spec.bandwidth_tbps,
    bits,
    constants: {
      etaBw: row.eta_bw,
      etaC: row.eta_c,
      aUs: row.overhead_a_us_per_layer,
      bUs: row.overhead_b_us_per_layer_per_log2g,
      memFrac: 0.9,
      mtpA: 1.721,
      mtpB: -0.0907,
    },
    confidence: cal ? "calibrated" : "extrapolated",
    band: cal ? (BAND_WIDE.has(gid) ? BAND_EXTRAP : BAND_CAL) : BAND_EXTRAP,
    tdpW: o.tdp_w ?? spec.tdp_w ?? null,
    sourceUrl: spec.source_url,
    captured: spec.captured,
  };
  return g;
}

// Build rule: list every null required value (memGb, bwTBs, peakTflops) across
// all GPUs; build-data.mjs fails the build on a non-empty list.
export function missingValues(gpus) {
  const out = [];
  for (const g of gpus) {
    if (g.memGb == null) out.push(`${g.id} memGb`);
    if (g.bwTBs == null) out.push(`${g.id} bwTBs`);
    for (const [b, v] of Object.entries(g.bits)) {
      if (v.peakTflops == null) out.push(`${g.id} bits["${b}"].peakTflops`);
    }
  }
  return out;
}

// Build the nine gpu records in contract order.
export function buildGpus() {
  const spec = byName(readSeed("gpus.json"), "gpu");
  const prec = byName(readSeed("gpu_precision.json"), "gpu");
  const ov = overridesByGpu(readSeed("gpu_overrides.json"));
  const cons = { global: null, perGpu: {} };
  for (const r of readSeed("constants.json")) {
    if (r.scope === "global") cons.global = r;
    if (r.scope === "per_gpu") cons.perGpu[r.gpu] = r;
  }
  if (!cons.global) fail(["constants.json: no global row"]);
  const out = [];
  for (const [gid, name] of Object.entries(GPU_MAP)) {
    const s = spec.get(name);
    const p = prec.get(name);
    if (!s || !p) fail([`gpu ${gid}: seed row missing for name ${name}`]);
    out.push(toGpu(gid, name, p, s, cons, ov));
  }
  return out;
}
