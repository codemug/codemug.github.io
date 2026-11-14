// One decode step for one replica, plus the smallest GPU count that fits a
// request (formulas 1-10 of scripts/tokenomics/README.md).
// Pure functions; model and gpu are the records of models.json and gpus.json, never mutated.

const BITS = [4, 8, 16];

export function checkBits(bits) {
  if (!BITS.includes(bits)) throw new Error('bits must be 4, 8 or 16, got ' + bits);
}

export function checkpoint(model, bits) {
  const ck = model.checkpoints[String(bits)];
  if (!ck) throw new Error('missing checkpoint for bits ' + bits + ' on model ' + (model.id ?? 'unknown'));
  return ck;
}

export function checkPositive(name, value) {
  if (!(value > 0)) throw new Error(name + ' must be positive, got ' + value);
}

// r of formula 1: DP attention never replicates the cache, MLA replicates it on
// every GPU, GQA replicates it across the kvHeads groups.
function rFactor(model, g, dpaFlag) {
  if (dpaFlag) return 1;
  if (model.mla) return g;
  return Math.max(1, g / model.kvHeads);
}

// Formula 1-10. conc = concurrent requests on the replica; B is the batch the
// step actually serves (min(conc, bMax), at least 1).
export function stepModel(model, bits, gpu, g, isl, osl, conc, opts = {}) {
  checkBits(bits);
  const ck = checkpoint(model, bits);
  checkPositive('isl', isl);
  checkPositive('osl', osl);
  const c = gpu.constants;
  const mtp = !!opts.mtp;
  const cachedShare = opts.cachedShare ?? 0;
  const dpaFlag = opts.dpa === undefined ? model.dpa : opts.dpa;
  const r = rFactor(model, g, dpaFlag);
  const weights = ck.sizeGb * 1e9;
  // Capacity reserves the whole context window for every request (worst case), never the request's own length.
  const reserve = Math.max(isl + osl, opts.ctx ?? 0);
  const bMax = (g * gpu.memGb * 1e9 * c.memFrac - weights) / (r * model.kvFp8 * reserve + model.S);
  const B = Math.max(1, Math.min(conc, bMax));
  const touched = model.E > 1 ? 1 - Math.pow(1 - model.k / model.E, B) : 0;
  // Formula 4: read model, nonrouted plus the fraction of routed weights touched.
  const wRead = (ck.readGbNonrouted + ck.readGbRouted * touched) * 1e9;
  const kvRead = B * (r * model.kvFp8 * (isl + osl / 2) + model.S);
  const tMem = (wRead + kvRead) / (g * gpu.bwTBs * 1e12 * c.etaBw);
  const F = gpu.bits[String(bits)].peakTflops;
  const tDec = (B * 2 * model.A) / (g * F * 1e12 * c.etaC);
  const tPre = tDec * (isl * (1 - cachedShare)) / osl;
  const t0 = model.L * (c.aUs + c.bUs * Math.log2(g)) * 1e-6;
  let t = Math.max(tMem, tDec) + tPre + t0;
  if (mtp) t /= Math.max(1, c.mtpA + c.mtpB * Math.log2(B));
  return {
    B,
    bMax,
    queued: Math.max(0, conc - B),
    tMemMs: tMem * 1e3,
    tDecMs: tDec * 1e3,
    tPreMs: tPre * 1e3,
    t0Ms: t0 * 1e3,
    tpotMs: t * 1e3,
    userTokS: 1 / t,
    outTokSPerGpu: B / (t * g),
    outTokSReplica: B / t,
  };
}

// Formula 11: smallest g in [1,2,4,8] whose memory holds the weights plus the
// KV cache for one request at ctx tokens; null when even 8 GPUs do not fit.
export function minGpus(model, bits, gpu, ctx) {
  checkBits(bits);
  const ck = checkpoint(model, bits);
  const c = gpu.constants;
  const weights = ck.sizeGb * 1e9;
  for (const g of [1, 2, 4, 8]) {
    const r = rFactor(model, g, model.dpa);
    if (g * gpu.memGb * 1e9 * c.memFrac >= weights + r * model.kvFp8 * ctx + model.S) return g;
  }
  return null;
}
