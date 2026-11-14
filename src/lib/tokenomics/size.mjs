// Replica and deployment sizing (formulas 11-12 of scripts/tokenomics/README.md).
// Pure functions; inputs are the records of models.json and gpus.json, never mutated.

import { stepModel, minGpus, checkpoint, checkPositive } from './step.mjs';

// Formula 12: integer binary search for the largest B in [1, floor(bMax)] whose
// per-stream speed at throughput factor tf still meets v tokens/s.
export function sizeReplica(model, bits, gpu, g, isl, osl, v, opts = {}) {
  checkpoint(model, bits);
  checkPositive('v', v);
  const mtp = !!opts.mtp;
  const cachedShare = opts.cachedShare ?? 0;
  const tf = opts.tf ?? 1;
  const stepOpts = { mtp, cachedShare, dpa: opts.dpa, ctx: opts.ctx };
  const st = stepModel(model, bits, gpu, g, isl, osl, 1, stepOpts);
  let hi = Math.floor(st.bMax);
  if (hi < 1) return { Bv: 0, meetsSpeed: false, stepAtBv: null };
  const ok = (B) => stepModel(model, bits, gpu, g, isl, osl, B, stepOpts).userTokS * tf >= v;
  if (!ok(1)) return { Bv: 1, meetsSpeed: false, stepAtBv: st };
  let lo = 1;
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2);
    if (ok(mid)) lo = mid;
    else hi = mid - 1;
  }
  // stepAtBv is the contract field the page shows for the chosen batch (the
  // reference golden pins only Bv and meetsSpeed).
  return { Bv: lo, meetsSpeed: true, stepAtBv: stepModel(model, bits, gpu, g, isl, osl, lo, stepOpts) };
}

// Formula 13: whole deployment for C parallel streams.
export function sizeDeployment(inp) {
  checkPositive('C', inp.C);
  checkPositive('v', inp.v);
  const g = minGpus(inp.model, inp.bits, inp.gpu, inp.ctx);
  if (g === null) return { offered: false, reason: 'needs more than one 8-GPU node' };
  const rep = sizeReplica(inp.model, inp.bits, inp.gpu, g, inp.isl, inp.osl, inp.v, {
    mtp: inp.mtp,
    cachedShare: inp.cachedShare,
    tf: inp.tf,
    ctx: inp.ctx,
  });
  if (rep.Bv < 1) return { offered: false, reason: 'one request does not fit in memory at this context' };
  const replicas = Math.ceil(inp.C / rep.Bv);
  return {
    offered: true,
    g,
    replicas,
    gpus: replicas * g,
    Bv: rep.Bv,
    meetsSpeed: rep.meetsSpeed,
    confidence: inp.gpu.confidence,
  };
}
