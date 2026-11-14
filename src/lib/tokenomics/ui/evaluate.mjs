// One full evaluation of a normalized page state: the expanded workload, the
// API cost, the self-hosted deployment and cost, the chart sweep and the
// API-vs-self crossover. The sweep covers only the visible range of the charts,
// 1 to xMax(C), sampled by chart-domain.mjs. Pure; never throws for a
// normalizeState state, returns errors instead.

import * as calc from '../calc.mjs';
import { scheduledNote } from './options.mjs';
import { xMaxFor, sampleCs, crossoverCs } from './chart-domain.mjs';
import { workloadFor } from './workload.mjs';


// The tier with the largest aboveInputTokens strictly below isl, or null.
function appliedTier(price, isl) {
  let best = null;
  for (const t of price.tiers ?? []) {
    if (isl > t.aboveInputTokens && (best === null || t.aboveInputTokens > best.aboveInputTokens)) best = t;
  }
  return best;
}

function selfNotOffered(reason, gpu) {
  return {
    offered: false, reason, g: null, replicas: null, gpus: null, Bv: null,
    meetsSpeed: null, soloTokS: null, confidence: null, band: gpu ? gpu.band : null,
    machines: null, servers: null, serverId: null, usdPerHour: null, usdPerMonth: null,
    usdPerMtokOut: null, parts: null, label: null,
  };
}

// Sweep with the self-hosted sides all null; the chart draws the note instead.
function nullBandSweep(cs, xMax, scale, apiArr, tokens1) {
  return {
    cs, xMax, scale, api: apiArr, selfMid: cs.map(() => null), selfLow: cs.map(() => null),
    selfHigh: cs.map(() => null), replicasMid: [], unitsMid: [], mtokPerMonth: cs.map((C) => (tokens1 / 1e6) * C),
  };
}

export function evaluate(state, data) {
  const s = state;
  const model = data.models.find((m) => m.id === s.modelId) ?? data.models[0];
  // isl, osl, cachedShare and the context reserved per request (see workload.mjs).
  const workload = workloadFor(s, model);
  const price = data.apiPrices.find((p) => p.id === s.apiId) ?? data.apiPrices[0];
  const apiMonthly = (C) => calc.apiMonthly({
    price, C, isl: workload.isl, osl: workload.osl, cachedShare: workload.cachedShare,
    v: s.v, ttftS: s.ttftS, hoursPerDay: s.hoursPerDay,
  });
  const api = {
    price,
    monthly: apiMonthly(s.C),
    tierApplied: appliedTier(price, workload.isl),
    scheduledNote: scheduledNote(price),
  };

  const errors = [];
  const xMax = xMaxFor(s.C, s.scale);
  let self = null;
  let sweep = null;
  let crossover = { low: null, mid: null, high: null };
  try {
    const rent = s.mode === 'rent';
    const offer = data.rentOffers.find((o) => o.id === s.rentOfferId) ?? data.rentOffers[0];
    const gpu = data.gpus.find((g) => g.id === (rent ? offer.gpu : s.buyGpu)) ?? data.gpus[0];
    const cs = sampleCs(xMax, s.scale);
    const tokens1 = apiMonthly(1).outputTokensPerMonth;
    const dep = calc.sizeDeployment({
      model, bits: s.bits, gpu, C: s.C, isl: workload.isl, osl: workload.osl,
      v: s.v, cachedShare: workload.cachedShare, ctx: workload.reserved, mtp: false, tf: 1,
    });
    // Cheapest server of the chosen GPU that holds a replica of d; ties go to
    // the smaller shape. Recomputed per d: the best shape changes with C.
    const pickBuy = (d) => {
      let best = null;
      for (const sv of data.buyOptions.servers.filter((x) => x.gpu === s.buyGpu && x.gpuCount >= d.g)) {
        const c = calc.buyMonthly({ deployment: d, server: sv, defaults: data.buyOptions.defaults });
        if (c.offered && (best === null || c.usdPerMonth < best.cost || (c.usdPerMonth === best.cost && sv.gpuCount < best.count))) best = { cost: c.usdPerMonth, count: sv.gpuCount, sv, res: c };
      }
      return best;
    };
    let server = null;
    if (dep.offered && !rent) server = pickBuy(dep)?.sv ?? null;
    const costOf = (d) => {
      if (rent) return calc.rentMonthly({ deployment: d, offer, hoursPerDay: s.hoursPerDay });
      const pick = pickBuy(d);
      return pick ? { ...pick.res, serverId: pick.sv.id } : null;
    };
    const res = dep.offered && (rent || server) ? costOf(dep) : null;
    if (!dep.offered || !res || !res.offered) {
      const reason = !dep.offered ? dep.reason : res ? res.reason : 'no buy server with enough GPUs for this replica';
      self = selfNotOffered(reason, gpu);
      sweep = nullBandSweep(cs, xMax, s.scale, cs.map((C) => apiMonthly(C).usdPerMonth), tokens1);
    } else {
      const tokens = api.monthly.outputTokensPerMonth;
      self = {
        offered: true, reason: null, g: dep.g, replicas: dep.replicas, gpus: dep.gpus,
        Bv: dep.Bv, meetsSpeed: dep.meetsSpeed, confidence: dep.confidence, band: gpu.band,
        machines: rent ? res.machines : null, servers: rent ? null : res.servers, serverId: rent ? null : server.id,
        usdPerHour: rent ? res.usdPerHour : null, usdPerMonth: res.usdPerMonth,
        usdPerMtokOut: res.usdPerMonth / (tokens / 1e6), parts: res.parts ?? null,
        label: rent ? offer.provider + ' ' + offer.instance : server.system ?? server.id,
        // The speed one request alone reaches on this setup (tokens per second); meetsSpeed is false when it is below v.
        soloTokS: calc.stepModel(model, s.bits, gpu, dep.g, workload.isl, workload.osl, 1, { cachedShare: workload.cachedShare, ctx: workload.reserved }).userTokS,
      };
      const inp = {
        model, bits: s.bits, gpu, C: 1, isl: workload.isl, osl: workload.osl, v: s.v,
        cachedShare: workload.cachedShare, ctx: workload.reserved, mtp: false, ttftS: s.ttftS,
        hoursPerDay: s.hoursPerDay, price,
        costFn: (d) => { const r = costOf(d); return r && r.offered ? r.usdPerMonth : null; },
      };
      const sw = calc.sweep(inp, cs);
      // Machines (rent) or servers (buy) behind each expected-speed point.
      const unitsOf = (replicas) => {
        const r = costOf({ ...dep, replicas, gpus: replicas * dep.g });
        return r && r.offered ? (rent ? r.machines : r.servers) : null;
      };
      sweep = {
        cs, xMax, scale: s.scale, api: sw.api, selfMid: sw.selfMid, selfLow: sw.selfLow, selfHigh: sw.selfHigh,
        replicasMid: sw.replicasMid, unitsMid: sw.replicasMid.map(unitsOf), mtokPerMonth: cs.map((C) => (tokens1 / 1e6) * C),
      };
      const all = crossoverCs();
      crossover = calc.crossover(calc.sweep(inp, all), all);
    }
  } catch (err) {
    errors.push(err.message);
    if (!self) self = selfNotOffered('evaluation failed: ' + err.message, null);
    if (!sweep) sweep = { cs: [], xMax, scale: s.scale, api: [], selfMid: [], selfLow: [], selfHigh: [], replicasMid: [], unitsMid: [], mtokPerMonth: [] };
    crossover = { low: null, mid: null, high: null };
  }
  return { errors, C: s.C, workload, api, self, sweep, crossover };
}
