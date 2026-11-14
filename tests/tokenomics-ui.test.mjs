// Tests for the tokenomics page-logic modules (UI-SPEC.md). Test data is built
// from tests/fixtures/tokenomics/fixtures.json in the shape the real files
// have; expected evaluate values are recomputed with calc, never literals.
// Run: node --test tests/tokenomics-ui.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { fmtUsd, fmtUsdAxis, fmtUsdSmall, fmtInt, fmtTokens, fmtPct } from '../src/lib/tokenomics/ui/format.mjs';
import { DEFAULT_STATE, normalizeState, toHash, fromHash } from '../src/lib/tokenomics/ui/state.mjs';
import { apiOptions, modelOptions, bitsOptions, rentProviders, rentMachines, buyGpus, fieldVisibility } from '../src/lib/tokenomics/ui/options.mjs';
import { evaluate } from '../src/lib/tokenomics/ui/evaluate.mjs';
import * as calc from '../src/lib/tokenomics/calc.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fx = JSON.parse(readFileSync(join(here, 'fixtures/tokenomics/fixtures.json'), 'utf8'));

// Keyed objects to arrays plus the fields the page modules need. A second
// rtx6000pro server (8 GPUs) makes the "smallest server" pick meaningful.
function buildData() {
  const priceX = {
    plain: { group: 'claude', provider: 'Anthropic', model: 'claude-sonnet-5-5' },
    tiered: { group: 'openai', provider: 'OpenAI', model: 'gpt-5', scheduled: [{ effective: '2026-12-01', input: 20, output: 75 }] },
    nocache: { group: 'gemini', provider: 'Google', model: 'gemini-3-flash' },
  };
  const offerX = {
    b200x8: { provider: 'Lambda', term: 'on_demand', instance: 'b200.8xlarge' },
    h100x4: { provider: 'AWS', term: 'on_demand', instance: 'h100.4xlarge' },
    rtx1: { provider: 'RunPod', term: 'on_demand', instance: 'rtx6000pro.1xlarge' },
  };
  const servers = Object.values(fx.servers).map((sv) => ({ ...sv, system: sv.gpu === 'b200' ? 'NVIDIA DGX B200' : 'Thinkmate GPX ' + sv.gpuCount + '-GPU' }));
  servers.push({ id: 'x:rtx8', gpu: 'rtx6000pro', gpuCount: 8, priceUsd: 236148, powerKw: 7.41, system: 'Thinkmate GPX 8-GPU' });
  return {
    models: fx.models,
    gpus: fx.gpus,
    apiPrices: Object.values(fx.prices).map((p) => ({ ...p, ...priceX[p.id.slice(2)] })),
    rentOffers: Object.values(fx.offers).map((o) => ({ ...o, ...offerX[o.id.slice(2)] })),
    buyOptions: { servers, defaults: fx.buyDefaults },
  };
}

const data = buildData();
const M = Object.fromEntries(fx.models.map((m) => [m.id, m]));
const G = Object.fromEntries(fx.gpus.map((g) => [g.id, g]));
const offer = (id) => data.rentOffers.find((o) => o.id === id);
const price = (id) => data.apiPrices.find((p) => p.id === id);

function closeTo(a, b) {
  assert.ok(typeof a === 'number' && Number.isFinite(a) && Math.abs(a - b) <= Math.max(1e-12, Math.abs(b) * 1e-9), a + ' != ' + b);
}

// The workload of Simple mode, written out from the spec and not from the code under test:
// every request holds ctx tokens, 80% cached input, 10% new input and 10% output, ctx reserved.
const simpleW = (ctx) => ({ isl: 0.9 * ctx, osl: 0.1 * ctx, cachedShare: 0.8 / 0.9, reserved: ctx });
// The numbers the cost and sizing code takes (the workload also carries the split in words).
const core = ({ isl, osl, cachedShare, reserved }) => ({ isl, osl, cachedShare, reserved });

test('format: spec examples and non-finite input', () => {
  assert.equal(fmtUsd(123), '$123'); assert.equal(fmtUsd(12345), '$12.3k'); assert.equal(fmtUsd(1234567), '$1.23M');
  assert.equal(fmtUsd(null), 'n/a'); assert.equal(fmtUsd(NaN), 'n/a'); assert.equal(fmtUsd(Infinity), 'n/a');
  assert.equal(fmtUsdSmall(0.1234), '$0.123'); assert.equal(fmtUsdSmall(Infinity), 'n/a');
  assert.equal(fmtInt(1234567), '1,234,567'); assert.equal(fmtInt(null), 'n/a');
  assert.equal(fmtTokens(4000), '4,000'); assert.equal(fmtTokens(40000), '40.0k'); assert.equal(fmtTokens(1200000), '1.2M');
  assert.equal(fmtTokens(NaN), 'n/a'); assert.equal(fmtPct(0.45), '45%'); assert.equal(fmtPct(null), 'n/a');
});

test('state: normalize clamps fields and replaces unknown ids', () => {
  const n = normalizeState({
    shape: 'weird', bits: 32, ctx: 999999999,
    C: 99999, v: 9999, hoursPerDay: 48, ttftS: -1, mode: 'weird',
    apiId: 'nope', modelId: 'nope', rentProvider: 'Nope', rentOfferId: 'nope',
    buyGpu: 'b300', agent: { c0: 0, N: 0, caching: 'yes' },
  }, data);
  assert.equal(n.shape, 'simple');
  assert.equal(n.bits, 4); assert.equal(n.C, 10000);
  assert.equal(n.v, 500); assert.equal(n.hoursPerDay, 24); assert.equal(n.ttftS, 0.5);
  assert.equal(n.mode, 'rent'); assert.equal(n.agent.c0, 1);
  assert.equal(n.agent.N, 1); assert.equal(n.agent.caching, false);
  assert.equal(n.apiId, data.apiPrices[0].id); assert.equal(n.modelId, data.models[0].id);
  assert.equal(n.rentProvider, 'AWS'); assert.equal(n.rentOfferId, offer('x:h100x4').id);
  assert.equal(n.buyGpu, 'rtx6000pro'); assert.equal(n.ctx, data.models[0].contextMax, 'capped at the model window');
  // The old single-request fields are gone from the state.
  for (const gone of ['isl', 'osl', 'cachedShare']) assert.ok(!(gone in n), gone + ' is not part of the state any more');
  // Context length: floor 2,000, cap at the model's window, whole tokens.
  const ctxOf = (ctx, extra = {}) => normalizeState({ ...DEFAULT_STATE, ctx, ...extra }, data).ctx;
  assert.equal(ctxOf(10), 2000); assert.equal(ctxOf(2000), 2000); assert.equal(ctxOf(2001), 2001);
  assert.equal(ctxOf(12345.6), 12346); assert.equal(ctxOf(NaN), DEFAULT_STATE.ctx > data.models[0].contextMax ? data.models[0].contextMax : DEFAULT_STATE.ctx);
  assert.equal(ctxOf(1e9, { modelId: 'kimi-k3.1-pro' }), M['kimi-k3.1-pro'].contextMax);
  // The three modes of writing the shape.
  const shapeOf = (shape) => normalizeState({ ...DEFAULT_STATE, shape }, data).shape;
  assert.equal(shapeOf('simple'), 'simple'); assert.equal(shapeOf('single'), 'simple');
  assert.equal(shapeOf('detailed'), 'detailed'); assert.equal(shapeOf('agent'), 'detailed');
  assert.equal(DEFAULT_STATE.shape, 'simple'); assert.equal(DEFAULT_STATE.ctx, 262144);
});

test('state: hash round trip is the identity; fromHash("") is {}', () => {
  const n1 = normalizeState(DEFAULT_STATE, data);
  assert.deepStrictEqual(n1, normalizeState(fromHash(toHash(n1)), data));
  const a = normalizeState({ ...DEFAULT_STATE, shape: 'detailed', detail: 'loop', ctx: 20000, agent: { c0: 30000, d: 2000, o: 500, N: 10, caching: false } }, data);
  // The agent loop works the reserved context out from the loop, so ctx is not written to the link at all.
  assert.ok(!/ctx=/.test(toHash(a)), 'no ctx in an agent loop link');
  assert.ok(/detail=loop/.test(toHash(a)) && /a_c0=30000/.test(toHash(a)));
  const backToDefault = { ...a, ctx: normalizeState(DEFAULT_STATE, data).ctx };
  assert.deepStrictEqual(backToDefault, normalizeState(fromHash(toHash(a)), data));
  // location.hash keeps the leading '#'; the first key (shape) must survive it.
  assert.deepStrictEqual(backToDefault, normalizeState(fromHash('#' + toHash(a)), data));
  const simple = normalizeState({ ...DEFAULT_STATE, ctx: 50000, C: 0.05 }, data);
  assert.ok(/ctx=50000/.test(toHash(simple)) && /C=0.05/.test(toHash(simple)));
  assert.deepStrictEqual(simple, normalizeState(fromHash(toHash(simple)), data));
  assert.deepStrictEqual(fromHash(''), {});
  assert.ok(/shape=detailed/.test(toHash(a)) && /shape=simple/.test(toHash(n1)));
  for (const gone of ['isl=', 'osl=', 'cachedShare=']) assert.ok(!toHash(n1).includes(gone), gone + ' is not written any more');
});

test('state: links made before the modes still open: single is Simple, agent is Detailed, old fields ignored', () => {
  const old = 'shape=single&isl=4000&osl=500&cachedShare=0.5&a_c0=20000&a_d=5000&a_o=1000&a_N=50&a_caching=true&C=100&v=30&hoursPerDay=12&apiId=Anthropic%3Aclaude-sonnet-5-5&modelId=qwen3.8-27b&bits=4&ctx=32768&mode=rent';
  const p = fromHash('#' + old);
  assert.equal(p.shape, 'simple'); assert.equal(p.ctx, 32768);
  for (const gone of ['isl', 'osl', 'cachedShare']) assert.ok(!(gone in p), gone + ' dropped');
  assert.deepEqual(p.agent, { c0: 20000, d: 5000, o: 1000, N: 50, caching: true });
  const agentLink = fromHash('#' + old.replace('shape=single', 'shape=agent'));
  assert.equal(agentLink.shape, 'detailed');
  assert.equal(normalizeState({ ...DEFAULT_STATE, ...agentLink }, data).shape, 'detailed');
  assert.equal(fromHash('#shape=detailed').shape, 'detailed'); assert.equal(fromHash('#shape=simple').shape, 'simple');
  // Tolerant: junk values and unknown keys never throw and never leak into the state.
  assert.deepEqual(fromHash('#shape=banana&foo=1&isl=abc&ctx=&C=x'), { shape: 'simple' });
  // Old links with an empty ctx still open, in either mode, and toHash never writes an empty value.
  for (const link of ['#shape=detailed&ctx=&C=100', '#shape=simple&ctx=', '#shape=agent&a_c0=20000&ctx=&C=50']) {
    const st = normalizeState({ ...DEFAULT_STATE, ...fromHash(link) }, data);
    assert.equal(st.ctx, normalizeState(DEFAULT_STATE, data).ctx, link);
    assert.ok(!/(^|&)\w+=(&|$)/.test(toHash(st)), 'no empty value in ' + toHash(st));
  }
  assert.doesNotThrow(() => normalizeState({ ...DEFAULT_STATE, ...fromHash('#isl=%E0%A4%A&shape=agent&ctx=zzz') }, data));
});

test('options: group order, scheduled note, estimated flag, disabledReason', () => {
  const g = apiOptions(data);
  assert.deepEqual(g.map((x) => x.label), ['Claude', 'OpenAI', 'Gemini']);
  assert.equal(g[0].items[0].note, null);
  assert.equal(g[1].items[0].note, 'price changes on 2026-12-01');
  const b = bitsOptions(M['kimi-k3.1-pro']);
  assert.equal(b['8'].estimated, true);
  assert.equal(b['8'].label, '8 bits (estimated)');
  assert.equal(b['4'].label, '4 bits');
  assert.equal(b['16'].enabled, true);
  assert.deepEqual(buyGpus(data).map((x) => x.id), ['rtx6000pro', 'b200']);
  assert.deepEqual(rentProviders(data), ['AWS', 'Lambda', 'RunPod']);
  assert.equal(rentMachines(data, 'AWS', 8)[0].disabledReason, 'needs 8 GPUs per replica');
  assert.equal(rentMachines(data, 'Lambda', 1)[0].disabledReason, null);
  assert.equal(modelOptions(data)[0].id, 'qwen3.8-27b');
});

test('evaluate: qwen 4-bit rent h100x4 matches calc', () => {
  const s = normalizeState({ ...DEFAULT_STATE, rentOfferId: 'x:h100x4' }, data);
  const res = evaluate(s, data);
  assert.deepEqual(res.errors, []);
  // Simple mode: the fixture model's window caps the default 262,144 at its contextMax.
  assert.equal(s.shape, 'simple'); assert.equal(s.ctx, M['qwen3.8-27b'].contextMax);
  const w = simpleW(s.ctx);
  assert.deepEqual(core(res.workload), w);
  const inp = { price: price(s.apiId), C: s.C, isl: w.isl, osl: w.osl, cachedShare: w.cachedShare, v: s.v, ttftS: s.ttftS, hoursPerDay: s.hoursPerDay };
  const dep = calc.sizeDeployment({ model: M['qwen3.8-27b'], bits: s.bits, gpu: G['h100'], C: s.C, isl: w.isl, osl: w.osl, v: s.v, cachedShare: w.cachedShare, ctx: w.reserved, mtp: false, tf: 1 });
  assert.equal(res.self.offered, true); assert.equal(res.self.g, dep.g); assert.equal(res.self.replicas, dep.replicas);
  assert.equal(res.self.Bv, dep.Bv); assert.equal(res.self.meetsSpeed, dep.meetsSpeed); assert.equal(res.self.confidence, dep.confidence);
  const exp = calc.rentMonthly({ deployment: dep, offer: offer('x:h100x4'), hoursPerDay: s.hoursPerDay });
  closeTo(res.self.usdPerMonth, exp.usdPerMonth); assert.equal(res.self.machines, exp.machines);
  closeTo(res.self.usdPerMtokOut, exp.usdPerMonth / (calc.apiMonthly(inp).outputTokensPerMonth / 1e6));
  closeTo(res.api.monthly.usdPerMonth, calc.apiMonthly(inp).usdPerMonth);
  assert.equal(res.api.tierApplied, null); assert.equal(res.api.scheduledNote, null);
  assert.equal(res.self.label, 'AWS h100.4xlarge');
  // C = 100: the charts run from 0.01 to 1,000, and every array has one entry per sample point.
  assert.equal(res.C, 100); assert.equal(res.sweep.xMax, 1000);
  assert.equal(res.sweep.cs[0], 0.01); assert.equal(res.sweep.cs[res.sweep.cs.length - 1], 1000);
  const fromOne = res.sweep.cs.indexOf(1);
  assert.ok(fromOne > 150 && res.sweep.cs.slice(fromOne, fromOne + 200).every((c, i) => c === i + 1), 'every integer from 1 to 200');
  assert.ok(res.sweep.cs.includes(100));
  for (const key of ['api', 'selfMid', 'selfLow', 'selfHigh', 'replicasMid', 'unitsMid', 'mtokPerMonth']) assert.equal(res.sweep[key].length, res.sweep.cs.length, key);
  // Below one stream a single replica serves everything: the self-hosting cost is flat, the API cost is not.
  const below = res.sweep.cs.map((c, i) => i).filter((i) => res.sweep.cs[i] < 1);
  assert.ok(below.every((i) => res.sweep.replicasMid[i] === 1 && res.sweep.selfMid[i] === res.sweep.selfMid[0]));
  assert.ok(res.sweep.api[below[below.length - 1]] > res.sweep.api[0] * 50, 'the API bill follows the usage');
  assert.ok(res.sweep.api.every((x) => x > 0));
});

test('evaluate: crossover equals calc.crossover over the crossover grid (fractions below 1, integers above)', () => {
  const s = normalizeState({ ...DEFAULT_STATE, rentOfferId: 'x:h100x4' }, data);
  const res = evaluate(s, data);
  const costFn = (d) => calc.rentMonthly({ deployment: d, offer: offer('x:h100x4'), hoursPerDay: 24 }).usdPerMonth;
  const w = simpleW(s.ctx);
  const inp = { model: M['qwen3.8-27b'], bits: 4, gpu: G['h100'], C: 1, isl: w.isl, osl: w.osl, v: 30, cachedShare: w.cachedShare, ctx: w.reserved, mtp: false, ttftS: 0.5, hoursPerDay: 24, price: price('x:plain'), costFn };
  // The grid the crossover is searched on: every 3-digit value from 0.01 to 0.999, then every integer to 10,000.
  const all = [];
  for (const scale of [0.0001, 0.001]) for (let m = 100; m <= 999; m++) all.push(Number((m * scale).toPrecision(3)));
  for (let c = 1; c <= 10000; c++) all.push(c);
  const cx = calc.crossover(calc.sweep(inp, all), all);
  assert.equal(res.crossover.low, cx.low);
  assert.equal(res.crossover.mid, cx.mid);
  assert.equal(res.crossover.high, cx.high);
});

test('evaluate: detailed mode, buy smallest server, kimi 4-bit b200 not offered', () => {
  const a = normalizeState({ ...DEFAULT_STATE, shape: 'detailed', detail: 'loop', agent: { c0: 30000, d: 2000, o: 500, N: 10, caching: true } }, data);
  const ra = evaluate(a, data);
  // Detailed: the average request of the loop, and the largest context the loop reaches
  // (30,000 + 9 x 2,500 + 500 = 53,000), capped at the model window.
  assert.deepEqual(ra.errors, []);
  assert.deepEqual(ra.workload, { ...calc.agentLoop(a.agent), reserved: Math.min(M['qwen3.8-27b'].contextMax, 53000), mix: null });
  assert.equal(ra.workload.isl, 30000 + 9 * 2500 / 2);
  const wide = normalizeState({ ...DEFAULT_STATE, shape: 'detailed', detail: 'loop', agent: { c0: 20000, d: 5000, o: 1000, N: 50, caching: true }, modelId: 'kimi-k3.1-pro' }, data);
  assert.equal(evaluate(wide, data).workload.reserved, Math.min(M['kimi-k3.1-pro'].contextMax, 20000 + 49 * 6000 + 1000), 'the default loop reaches 315,000 and the window caps it');

  const b = normalizeState({ ...DEFAULT_STATE, mode: 'buy', buyGpu: 'rtx6000pro' }, data);
  const rb = evaluate(b, data);
  assert.deepEqual(rb.errors, []);
  const wb = simpleW(b.ctx);
  assert.deepEqual(core(rb.workload), wb);
  const depB = calc.sizeDeployment({ model: M['qwen3.8-27b'], bits: 4, gpu: G['rtx6000pro'], C: b.C, isl: wb.isl, osl: wb.osl, v: b.v, cachedShare: wb.cachedShare, ctx: wb.reserved, mtp: false, tf: 1 });
  assert.equal(rb.self.offered, true); assert.equal(rb.self.label, 'Thinkmate GPX 4-GPU');
  const expB = calc.buyMonthly({ deployment: depB, server: data.buyOptions.servers.find((x) => x.id === 'x:rtx4'), defaults: fx.buyDefaults });
  assert.equal(rb.self.servers, expB.servers); closeTo(rb.self.usdPerMonth, expB.usdPerMonth);
  assert.equal(rb.self.usdPerHour, null); assert.deepEqual(rb.self.parts, expB.parts);

  const k = normalizeState({ ...DEFAULT_STATE, modelId: 'kimi-k3.1-pro', bits: 4, rentProvider: 'Lambda', rentOfferId: 'x:b200x8' }, data);
  const rk = evaluate(k, data);
  assert.deepEqual(rk.errors, []);
  const wk = simpleW(k.ctx);
  const depK = calc.sizeDeployment({ model: M['kimi-k3.1-pro'], bits: 4, gpu: G['b200'], C: k.C, isl: wk.isl, osl: wk.osl, v: k.v, cachedShare: wk.cachedShare, ctx: wk.reserved, mtp: false, tf: 1 });
  assert.equal(rk.self.offered, false); assert.equal(rk.self.reason, depK.reason);
  assert.ok(rk.sweep.selfMid.every((x) => x === null) && rk.sweep.selfLow.every((x) => x === null));
  assert.ok(rk.sweep.selfHigh.every((x) => x === null)); assert.deepEqual(rk.sweep.replicasMid, []);
  assert.deepEqual(rk.crossover, { low: null, mid: null, high: null });
  assert.ok(rk.sweep.api.length === rk.sweep.cs.length && rk.sweep.cs.length > 100 && rk.sweep.api.every((x) => x > 0));
});

test('format: fmtUsdAxis powers of ten without trailing zeros', () => {
  assert.equal(fmtUsdAxis(100), '$100'); assert.equal(fmtUsdAxis(1000), '$1k'); assert.equal(fmtUsdAxis(10000), '$10k');
  assert.equal(fmtUsdAxis(100000), '$100k'); assert.equal(fmtUsdAxis(1e6), '$1M'); assert.equal(fmtUsdAxis(1e7), '$10M');
  assert.equal(fmtUsdAxis(1e9), '$1B'); assert.equal(fmtUsdAxis(0.1), '$0.1'); assert.equal(fmtUsdAxis(0.01), '$0.01');
  assert.equal(fmtUsdAxis(1500000), '$1.50M'); assert.equal(fmtUsdAxis(null), 'n/a');
});

test('visibility: fieldVisibility shows the fields of each mode and shape of request', () => {
  // Simple: the context length and the one-line note. Detailed: the shape of each request, then either the
  // context length with the split, or the agent loop (which has no context length of its own).
  assert.deepEqual(fieldVisibility({ shape: 'simple', detail: 'split' }), { detail: false, ctx: true, hint: true, split: false, loop: false });
  assert.deepEqual(fieldVisibility({ shape: 'simple', detail: 'loop' }), { detail: false, ctx: true, hint: true, split: false, loop: false }, 'Simple ignores the detail');
  assert.deepEqual(fieldVisibility({ shape: 'detailed', detail: 'split' }), { detail: true, ctx: true, hint: false, split: true, loop: false });
  assert.deepEqual(fieldVisibility({ shape: 'detailed', detail: 'loop' }), { detail: true, ctx: false, hint: false, split: false, loop: true });
});

test('evaluate: buy picks the cheapest server shape per deployment (real data)', () => {
  const JR = (f) => JSON.parse(readFileSync(join(here, '../public/data/tokenomics/' + f), 'utf8'));
  const real = { models: JR('models.json'), gpus: JR('gpus.json'), apiPrices: JR('api_prices.json'), rentOffers: JR('rent_offers.json'), buyOptions: JR('buy_options.json') };
  const dep = (gpuId, C) => { const st = normalizeState({ ...DEFAULT_STATE, mode: 'buy', buyGpu: gpuId, C }, real); const w = simpleW(st.ctx);
    return calc.sizeDeployment({ model: real.models.find((m) => m.id === st.modelId) ?? real.models[0], bits: st.bits, gpu: real.gpus.find((g) => g.id === gpuId), C, isl: w.isl, osl: w.osl, v: st.v, cachedShare: w.cachedShare, ctx: w.reserved, mtp: false, tf: 1 }); };
  const cost = (d, sv) => calc.buyMonthly({ deployment: d, server: sv, defaults: real.buyOptions.defaults }).usdPerMonth;
  const cheapest = (gpuId, d) => real.buyOptions.servers.filter((x) => x.gpu === gpuId && x.gpuCount >= d.g).sort((a, b) => cost(d, a) - cost(d, b) || a.gpuCount - b.gpuCount)[0];
  const a100 = evaluate(normalizeState({ ...DEFAULT_STATE, mode: 'buy', buyGpu: 'rtx6000pro', C: 100 }, real), real);
  const d100 = dep('rtx6000pro', 100);
  assert.equal(d100.replicas, 100, 'Simple default: one request per replica, so 100 replicas');
  assert.equal(a100.self.serverId, 'rtx6000pro-8', 'C=100 (100 one-GPU replicas): 8-GPU servers beat 1-GPU servers');
  assert.equal(a100.self.usdPerMonth, cost(d100, cheapest('rtx6000pro', d100)), 'C=100 cost is the minimum over all candidates');
  const a1 = evaluate(normalizeState({ ...DEFAULT_STATE, mode: 'buy', buyGpu: 'rtx6000pro', C: 1 }, real), real);
  assert.equal(a1.self.serverId, 'rtx6000pro-1', 'C=1 (1 replica): the 1-GPU server is cheapest');
  assert.equal(a1.self.usdPerMonth, cost(dep('rtx6000pro', 1), cheapest('rtx6000pro', dep('rtx6000pro', 1))));
  const ab = evaluate(normalizeState({ ...DEFAULT_STATE, mode: 'buy', buyGpu: 'b200' }, real), real);
  assert.equal(ab.self.serverId, 'b200-8'); assert.equal(ab.self.usdPerMonth, cost(dep('b200', 100), cheapest('b200', dep('b200', 100))), 'single b200 server, unchanged');
  const i106 = a100.sweep.cs.indexOf(106); assert.ok(i106 > 0, '106 is the sweep point nearest to 100');
  assert.equal(a100.sweep.selfMid[i106], cost(dep('rtx6000pro', 106), cheapest('rtx6000pro', dep('rtx6000pro', 106))), 'sweep picks per C like the headline');
});
