// API, rent and buy costs, and the agent-loop shape (formulas 13-17 of
// scripts/tokenomics/README.md). Pure functions, never mutate inputs.

import { checkPositive } from './step.mjs';

const DAYS = 30.4; // load hours are hoursPerDay * 30.4, as the README states

// Formula 14, tier step: the tier with the largest aboveInputTokens strictly
// below isl wins; no tier match means the base prices.
function tierPrices(price, isl) {
  let best = null;
  for (const t of price.tiers ?? []) {
    if (isl > t.aboveInputTokens && (best === null || t.aboveInputTokens > best.aboveInputTokens)) best = t;
  }
  return best ?? price;
}

// Formula 14. USD per request; cachedInput null means charge input for the cache.
export function apiCostPerRequest(price, isl, osl, cachedShare) {
  const p = tierPrices(price, isl);
  const pIn = p.input;
  const pOut = p.output;
  const cachedUnit = p.cachedInput == null ? pIn : p.cachedInput;
  return (isl * (1 - cachedShare) * pIn + isl * cachedShare * cachedUnit + osl * pOut) / 1e6;
}

// Formula 14. ttftS defaults to 0.5 s (drafter's call, editable in the page).
export function apiMonthly({ price, C, isl, osl, cachedShare, v, ttftS = 0.5, hoursPerDay }) {
  checkPositive('C', C);
  checkPositive('isl', isl);
  checkPositive('osl', osl);
  checkPositive('v', v);
  const T = osl / v + ttftS;
  const requestsPerHour = (3600 * C) / T;
  const usdPerMonth = requestsPerHour * apiCostPerRequest(price, isl, osl, cachedShare ?? 0) * hoursPerDay * DAYS;
  const outputTokensPerMonth = requestsPerHour * osl * hoursPerDay * DAYS;
  return {
    requestsPerHour,
    usdPerMonth,
    outputTokensPerMonth,
    usdPerMtokOut: usdPerMonth / (outputTokensPerMonth / 1e6),
  };
}

// Formula 15. A machine holds floor(gpuCount / g) replicas; usdPerMtokOut stays
// null because rent takes no token count.
export function rentMonthly({ deployment, offer, hoursPerDay }) {
  if (deployment.g > offer.gpuCount) {
    return { offered: false, reason: 'replica needs more GPUs than the machine has' };
  }
  const perMachine = Math.floor(offer.gpuCount / deployment.g);
  const machines = Math.ceil(deployment.replicas / perMachine);
  const usdPerHour = machines * (offer.pricePerHour + (offer.addonPerHour ?? 0));
  const usdPerMonth = usdPerHour * hoursPerDay * DAYS;
  return { offered: true, machines, usdPerHour, usdPerMonth, usdPerMtokOut: null };
}

// Formula 16. Buy ignores hoursPerDay (always 24 hours); defaults come from
// buy_options.json, a partial caller override is already merged in by the caller.
export function buyMonthly({ deployment, server, defaults }) {
  if (deployment.g > server.gpuCount) {
    return { offered: false, reason: 'replica needs more GPUs than the server has' };
  }
  const servers = Math.ceil(deployment.replicas / Math.floor(server.gpuCount / deployment.g));
  const amort = (servers * server.priceUsd * (1 - defaults.residualPct / 100)) / (defaults.amortYears * 12);
  const energy = defaults.coloIncludesEnergy
    ? 0
    : servers * server.powerKw * defaults.pue * defaults.hoursPerMonth * defaults.electricityUsdPerKwh;
  const colo = servers * server.powerKw * defaults.coloUsdPerKwMonth;
  const support = (servers * server.priceUsd * defaults.supportPctPerYear) / 100 / 12;
  const usdPerMonth = amort + energy + colo + support;
  return { offered: true, servers, usdPerMonth, parts: { amort, energy, colo, support } };
}

// Formula 18: the average request of an agent loop of N turns.
export function agentLoop({ c0, d, o, N, caching }) {
  const isl = c0 + (N - 1) * (d + o) / 2;
  let cachedShare = 0;
  if (caching && N > 1) cachedShare = Math.min(1, Math.max(0, 1 - (d + o) / isl));
  return { isl, osl: o, cachedShare };
}
