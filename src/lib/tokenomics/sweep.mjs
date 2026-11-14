// Cost sweep across parallel streams and the API-vs-self crossover
// (formula 18 of scripts/tokenomics/README.md).
// Pure functions, never mutate inputs.

import { sizeDeployment } from './size.mjs';
import { apiMonthly } from './cost.mjs';

// Formula 19: sizeDeployment is evaluated once per throughput factor (the
// replica batch Bv does not depend on C), then replicas = ceil(C / Bv) per C.
// inp carries the price object and costFn(deployment, outputTokensPerMonth) ->
// usdPerMonth as extra fields, like the reference's sweep(inp, cs, price, cost_fn).
export function sweep(inp, cs) {
  const out = { api: [], selfMid: [], selfLow: [], selfHigh: [], replicasMid: [] };
  const reps = {
    selfMid: sizeDeployment({ ...inp, C: 1, tf: 1 }),
    selfLow: sizeDeployment({ ...inp, C: 1, tf: inp.gpu.band.high }),
    selfHigh: sizeDeployment({ ...inp, C: 1, tf: inp.gpu.band.low }),
  };
  for (const C of cs) {
    const a = apiMonthly({
      price: inp.price,
      C,
      isl: inp.isl,
      osl: inp.osl,
      cachedShare: inp.cachedShare,
      v: inp.v,
      ttftS: inp.ttftS,
      hoursPerDay: inp.hoursPerDay,
    });
    out.api.push(a.usdPerMonth);
    for (const key of ['selfMid', 'selfLow', 'selfHigh']) {
      const r = reps[key];
      if (!r.offered) {
        out[key].push(null);
        continue;
      }
      const dep = { ...r, replicas: Math.ceil(C / r.Bv) };
      dep.gpus = dep.replicas * dep.g;
      out[key].push(inp.costFn(dep, a.outputTokensPerMonth));
      if (key === 'selfMid') out.replicasMid.push(dep.replicas);
    }
  }
  return out;
}

// First C where api > selfLow, first where api > selfMid, first where api >
// selfHigh; null for each if never.
export function crossover(sweepResult, cs) {
  const first = (key) => {
    for (let i = 0; i < cs.length; i++) {
      const s = sweepResult[key][i];
      if (s !== null && sweepResult.api[i] > s) return cs[i];
    }
    return null;
  };
  return { low: first('selfLow'), mid: first('selfMid'), high: first('selfHigh') };
}
