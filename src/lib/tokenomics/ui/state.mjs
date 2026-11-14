// Page state: defaults, normalization into range, and URL-fragment round trip.
// Pure functions; normalizeState returns a new object and never mutates input.
//
// The workload has two modes. 'simple': every request holds `ctx` tokens in
// total. 'detailed': the agent loop in `agent`. Links made before the modes
// existed still open: shape=single is Simple, shape=agent is Detailed, and the
// old isl, osl and cachedShare parameters are ignored.

import { ctxBounds } from './workload.mjs';
import { roundC } from './streams.mjs';

export const DEFAULT_STATE = {
  shape: 'simple',
  agent: { c0: 20000, d: 5000, o: 1000, N: 50, caching: true },
  C: 100,
  v: 30,
  hoursPerDay: 24,
  apiId: 'ref:qwen3.8-27b', // the same model on its maker's API: a like-for-like price
  modelId: 'qwen3.8-27b',
  bits: 4,
  ctx: 262144,
  mode: 'rent',
  buyGpu: 'rtx6000pro',
  rentProvider: 'AWS',
  rentOfferId: 'AWS:g7e.2xlarge:on_demand',
  ttftS: 0.5,
};

const BUY_GPUS = ['rtx6000pro', 'b200', 'b300'];

function clamp(x, lo, hi) {
  return Math.min(hi, Math.max(lo, x));
}

function intOr(x, fallback) {
  return typeof x === 'number' && Number.isFinite(x) ? Math.round(x) : fallback;
}

function numOr(x, fallback) {
  return typeof x === 'number' && Number.isFinite(x) ? x : fallback;
}

// Returns a NEW valid state: numbers clamped into range, unknown ids replaced
// by the first valid one, the rent offer kept only if it exists for the provider.
export function normalizeState(state, data) {
  const s = state ?? {};
  const agent = { ...DEFAULT_STATE.agent, ...(s.agent ?? {}) };
  const model = data.models.find((m) => m.id === s.modelId) ?? data.models[0];
  const provider = data.rentOffers.some((o) => o.provider === s.rentProvider)
    ? s.rentProvider
    : [...new Set(data.rentOffers.map((o) => o.provider))].sort()[0];
  const offer = data.rentOffers.find((o) => o.id === s.rentOfferId && o.provider === provider)
    ?? data.rentOffers.find((o) => o.provider === provider);
  const buyGpu = BUY_GPUS.filter((id) => data.buyOptions.servers.some((sv) => sv.gpu === id));
  const [ctxLo, ctxHi] = ctxBounds(model);
  return {
    shape: s.shape === 'detailed' || s.shape === 'agent' ? 'detailed' : 'simple',
    agent: {
      c0: Math.max(1, intOr(agent.c0, DEFAULT_STATE.agent.c0)),
      d: Math.max(1, intOr(agent.d, DEFAULT_STATE.agent.d)),
      o: Math.max(1, intOr(agent.o, DEFAULT_STATE.agent.o)),
      N: Math.max(1, intOr(agent.N, DEFAULT_STATE.agent.N)),
      caching: agent.caching === true,
    },
    C: roundC(numOr(s.C, DEFAULT_STATE.C)),
    v: clamp(numOr(s.v, DEFAULT_STATE.v), 1, 500),
    hoursPerDay: clamp(intOr(s.hoursPerDay, DEFAULT_STATE.hoursPerDay), 1, 24),
    apiId: data.apiPrices.some((p) => p.id === s.apiId) ? s.apiId : data.apiPrices[0].id,
    modelId: model.id,
    bits: [4, 8, 16].includes(s.bits) ? s.bits : DEFAULT_STATE.bits,
    ctx: clamp(intOr(s.ctx, DEFAULT_STATE.ctx), ctxLo, ctxHi),
    mode: s.mode === 'buy' ? 'buy' : 'rent',
    buyGpu: buyGpu.includes(s.buyGpu) ? s.buyGpu : buyGpu[0],
    rentProvider: provider,
    rentOfferId: offer.id,
    ttftS: numOr(s.ttftS, DEFAULT_STATE.ttftS) >= 0 ? numOr(s.ttftS, DEFAULT_STATE.ttftS) : DEFAULT_STATE.ttftS,
  };
}

// State through a URL fragment (URLSearchParams); agent fields are a_-prefixed.
export function toHash(state) {
  const p = new URLSearchParams();
  const set = (k, v) => {
    if (v !== null && v !== undefined && v !== '') p.set(k, String(v));
  };
  set('shape', state.shape);
  set('a_c0', state.agent.c0);
  set('a_d', state.agent.d);
  set('a_o', state.agent.o);
  set('a_N', state.agent.N);
  set('a_caching', state.agent.caching);
  set('C', state.C);
  set('v', state.v);
  set('hoursPerDay', state.hoursPerDay);
  set('apiId', state.apiId);
  set('modelId', state.modelId);
  set('bits', state.bits);
  // ctx is the Simple context length; Detailed works it out from the loop.
  if (state.shape === 'simple') set('ctx', state.ctx);
  set('mode', state.mode);
  set('buyGpu', state.buyGpu);
  set('rentProvider', state.rentProvider);
  set('rentOfferId', state.rentOfferId);
  set('ttftS', state.ttftS);
  return p.toString();
}

export function fromHash(hash) {
  // location.hash keeps a leading '#'; unstripped, it merges into the first key.
  const p = new URLSearchParams((hash ?? '').replace(/^#/, ''));
  if (p.size === 0) return {};
  const out = {};
  const put = (k, v) => {
    if (v !== undefined) out[k] = v;
  };
  const str = (k) => (p.get(k) === null ? undefined : p.get(k));
  const num = (k) => {
    const x = p.get(k);
    if (x === null || x.trim() === '') return undefined;
    const n = Number(x);
    return Number.isFinite(n) ? n : undefined;
  };
  const bool = (k) => {
    const x = p.get(k);
    return x === 'true' || x === 'false' ? x === 'true' : undefined;
  };
  const shape = str('shape');
  put('shape', shape === undefined ? undefined : shape === 'agent' || shape === 'detailed' ? 'detailed' : 'simple');
  put('C', num('C'));
  put('v', num('v'));
  put('hoursPerDay', num('hoursPerDay'));
  put('apiId', str('apiId'));
  put('modelId', str('modelId'));
  put('bits', num('bits'));
  put('ctx', num('ctx'));
  put('mode', str('mode'));
  put('buyGpu', str('buyGpu'));
  put('rentProvider', str('rentProvider'));
  put('rentOfferId', str('rentOfferId'));
  put('ttftS', num('ttftS'));
  const agent = {};
  for (const [pk, k] of [['a_c0', 'c0'], ['a_d', 'd'], ['a_o', 'o'], ['a_N', 'N']]) {
    const v = num(pk);
    if (v !== undefined) agent[k] = v;
  }
  const caching = bool('a_caching');
  if (caching !== undefined) agent.caching = caching;
  if (Object.keys(agent).length > 0) out.agent = agent;
  return out;
}
