// Tests for buildView (UI-SPEC-2.md). Expected strings are built from the
// evaluate result and the formatters, not typed literals. DOM code is not
// unit-tested here. Run: node --test tests/tokenomics-view.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { fmtUsd, fmtUsdSmall, fmtInt, fmtPct, fmtStreams } from '../src/lib/tokenomics/ui/format.mjs';
import { DEFAULT_STATE, normalizeState } from '../src/lib/tokenomics/ui/state.mjs';
import { evaluate } from '../src/lib/tokenomics/ui/evaluate.mjs';
import { buildView, CHART_CAPTION } from '../src/lib/tokenomics/ui/view.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fx = JSON.parse(readFileSync(join(here, 'fixtures/tokenomics/fixtures.json'), 'utf8'));

const BASIS = {
  amortYears: { kind: 'recommendation' },
  electricityUsdPerKwh: { kind: 'published' },
  coloUsdPerKwMonth: { kind: 'aggregator' },
  pue: { kind: 'arithmetic' },
  supportPctPerYear: { kind: 'recommendation' },
};

function buildData() {
  const priceX = {
    plain: { group: 'claude', provider: 'Anthropic', model: 'claude-sonnet-5-5' },
    tiered: { group: 'openai', provider: 'OpenAI', model: 'gpt-5', note: 'Promotional price for the first three months.', scheduled: [{ effective: '2026-12-01', input: 20, output: 75 }] },
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
    buyOptions: { servers, defaults: { ...fx.buyDefaults, basis: BASIS } },
  };
}

const data = buildData();
const M = Object.fromEntries(fx.models.map((m) => [m.id, m]));
const G = Object.fromEntries(fx.gpus.map((g) => [g.id, g]));

// Base offered case: qwen 4-bit, rent h100x4, C = 100.
const state = normalizeState({ ...DEFAULT_STATE, rentOfferId: 'x:h100x4' }, data);
const result = evaluate(state, data);

function headlineFor(C, apiUsd, selfUsd) {
  const ratio = apiUsd / selfUsd;
  const verdict = Math.abs(ratio - 1) <= 0.05 ? 'about the same' : ratio >= 1 ? ratio.toFixed(1) + ' times cheaper' : (1 / ratio).toFixed(1) + ' times dearer';
  const cText = C === 1 ? '1 parallel stream' : fmtStreams(C) + ' parallel streams';
  return 'At ' + cText + ' the API costs ' + fmtUsd(apiUsd) + ' a month and self-hosting costs ' + fmtUsd(selfUsd) + ' a month (' + verdict + ').';
}

test('view: headline wording (cheaper, dearer, about the same)', () => {
  const view = buildView(result, state, data);
  assert.equal(view.api.title, 'claude-sonnet-5-5 API');
  assert.equal(view.chartCaption, CHART_CAPTION);
  for (const part of ['the dashed vertical line marks the crossover', 'the solid vertical line is your setting', 'The horizontal range starts at 0.01', 'its right edge follows your parallel streams setting', 'at least three times your number', 'dashed when the speed you asked for is missed']) assert.ok(view.chartCaption.includes(part), part);
  // A crossover off the right edge is said in words, because it is not drawn.
  const far = { ...result, C: 10, sweep: { ...result.sweep, xMax: 100 }, crossover: { low: 150, mid: 150, high: null } };
  assert.equal(buildView(far, state, data).chartCaption, CHART_CAPTION + ' The crossover is not drawn because it is off the right edge: self-hosting becomes cheaper from about 150 parallel streams.');
  assert.equal(buildView({ ...far, crossover: { low: 50, mid: 50, high: null } }, state, data).chartCaption, CHART_CAPTION);
  assert.equal(view.api.monthly, fmtUsd(result.api.monthly.usdPerMonth));
  assert.equal(view.api.perMtok, fmtUsdSmall(result.api.monthly.usdPerMtokOut) + ' per million output tokens');
  assert.equal(view.headline, headlineFor(state.C, result.api.monthly.usdPerMonth, result.self.usdPerMonth));
  assert.ok(view.headline.includes('times cheaper'));
  // A 2,000-token context at one stream: a short request costs the API little, a machine is dearer.
  const s1 = normalizeState({ ...DEFAULT_STATE, rentOfferId: 'x:h100x4', C: 1, ctx: 2000 }, data);
  const r1 = evaluate(s1, data);
  assert.ok(r1.api.monthly.usdPerMonth < r1.self.usdPerMonth, 'self dearer at C = 1 with a short context');
  assert.ok(buildView(r1, s1, data).headline.startsWith('At 1 parallel stream '), 'singular at C = 1');
  assert.ok(buildView(r1, s1, data).headline.includes('times dearer'));
  // Fractions of a stream: the average number of requests in flight.
  for (const [C, text] of [[0.05, '0.05 parallel streams'], [0.1, '0.1 parallel streams'], [0.3, '0.3 parallel streams'], [2.5, '2.5 parallel streams'], [1, '1 parallel stream'], [1000, '1,000 parallel streams']]) {
    const sf = normalizeState({ ...DEFAULT_STATE, rentOfferId: 'x:h100x4', C }, data);
    const rf = evaluate(sf, data);
    const hl = buildView(rf, sf, data).headline;
    assert.ok(hl.startsWith('At ' + text + ' the API costs $'), hl);
    assert.equal(hl, headlineFor(C, rf.api.monthly.usdPerMonth, rf.self.usdPerMonth));
  }
  const near = { ...result, api: { ...result.api, monthly: { ...result.api.monthly, usdPerMonth: result.self.usdPerMonth * 1.02 } } };
  assert.ok(buildView(near, state, data).headline.includes('about the same'));
});

test('view: crossover text (all five cases plus not offered), with the idle-GPU explanation', () => {
  const IDLE = " Below that, the GPU would sit partly idle, so the API's pay-per-use is cheaper.";
  assert.ok(result.crossover.low === result.crossover.mid && result.crossover.mid === result.crossover.high, 'case a: all edges cross at one C');
  // Simple default: every request is a 261k-token prompt with no cache, so self-hosting wins from a fraction of a stream.
  assert.equal(result.crossover.low, 0.292);
  assert.equal(buildView(result, state, data).crossoverText, 'Self-hosting becomes cheaper from about 0.29 parallel streams.' + IDLE);
  const c13 = { ...result, crossover: { low: 13, mid: 13, high: 13 } };
  assert.equal(buildView(c13, state, data).crossoverText, 'Self-hosting becomes cheaper from about 13 parallel streams.' + IDLE);
  assert.equal(buildView({ ...result, crossover: { low: 1, mid: 1, high: 1 } }, state, data).crossoverText, 'Self-hosting becomes cheaper from about 1 parallel stream.' + IDLE);
  assert.equal(buildView({ ...result, crossover: { low: 2.5, mid: 2.5, high: 2.5 } }, state, data).crossoverText, 'Self-hosting becomes cheaper from about 2.5 parallel streams.' + IDLE);
  assert.equal(buildView({ ...result, crossover: { low: 0.05, mid: 0.05, high: 0.05 } }, state, data).crossoverText, 'Self-hosting becomes cheaper from about 0.05 parallel streams.' + IDLE);
  // At the left edge of the charts nothing is lower: it is cheaper everywhere, and there is no idle region to explain.
  assert.equal(buildView({ ...result, crossover: { low: 0.01, mid: 0.01, high: 0.01 } }, state, data).crossoverText, 'Self-hosting is cheaper everywhere on the charts, even at 0.01 parallel streams.');
  assert.equal(buildView({ ...result, crossover: { low: 14, mid: 30, high: 52 } }, state, data).crossoverText, 'At the expected speed, self-hosting becomes cheaper from about 30 parallel streams. If the GPUs run faster than expected, it happens from 14; if they run slower, from 52.' + IDLE);
  assert.equal(buildView({ ...result, crossover: { low: 30, mid: 30, high: 52 } }, state, data).crossoverText, 'At the expected speed, self-hosting becomes cheaper from about 30 parallel streams. If the GPUs run faster than expected, that point stays the same; if they run slower, from 52.' + IDLE);
  assert.equal(buildView({ ...result, crossover: { low: 0.4, mid: 3.5, high: null } }, state, data).crossoverText, "At the expected speed, self-hosting becomes cheaper from about 3.5 parallel streams. If the GPUs run faster than expected, it happens from 0.4; if they run slower, it doesn't happen within 10,000 streams." + IDLE);
  assert.equal(buildView({ ...result, crossover: { low: null, mid: null, high: null } }, state, data).crossoverText, 'The API stays cheaper all the way up to 10,000 parallel streams.');
  const ks = normalizeState({ ...DEFAULT_STATE, modelId: 'kimi-k3.1-pro', bits: 4, rentProvider: 'Lambda', rentOfferId: 'x:b200x8' }, data);
  const kr = evaluate(ks, data);
  assert.equal(buildView(kr, ks, data).crossoverText, 'This model is not offered on this hardware: ' + kr.self.reason + '.');
});

test('view: api notes (scheduled, promotional, long-context)', () => {
  const p = data.apiPrices.find((x) => x.id === 'x:tiered');
  const st = normalizeState({ ...DEFAULT_STATE, apiId: 'x:tiered' }, data);
  const view = buildView(evaluate(st, data), st, data);
  assert.ok(view.api.notes.includes('Price changes on ' + p.scheduled[0].effective + ' to $' + p.scheduled[0].input + ' in and $' + p.scheduled[0].output + ' out per million tokens.'));
  assert.ok(view.api.notes.includes(p.note));
  // Simple: the input is the context length minus 1,000, so this context puts it just over the tier's threshold.
  const st2 = normalizeState({ ...DEFAULT_STATE, apiId: 'x:tiered', modelId: 'kimi-k3.1-pro', ctx: p.tiers[0].aboveInputTokens + 1001 }, data);
  const res2 = evaluate(st2, data);
  assert.ok(res2.api.tierApplied !== null, 'tier applies above its threshold');
  assert.ok(buildView(res2, st2, data).api.notes.includes('Long-context price applies above ' + fmtInt(res2.api.tierApplied.aboveInputTokens) + ' input tokens.'));
});

test('view: estimated checkpoint note', () => {
  const st = normalizeState({ ...DEFAULT_STATE, modelId: 'kimi-k3.1-pro', bits: 8, rentProvider: 'Lambda', rentOfferId: 'x:b200x8' }, data);
  const res = evaluate(st, data);
  const ck = M['kimi-k3.1-pro'].checkpoints['8'];
  assert.equal(res.self.offered, false);
  assert.ok(buildView(res, st, data).self.notes.includes('No checkpoint at this bit width exists; the size is estimated at ' + ck.bitsPerWeight + ' bits per weight.'));
});

test('view: rent and buy deployment text', () => {
  const offer = data.rentOffers.find((o) => o.id === 'x:h100x4');
  const gpu = G['h100'];
  const ck = M['qwen3.8-27b'].checkpoints['4'];
  const weights = '; weights: ' + ck.repo + ' (' + ck.sizeGb.toFixed(1) + ' GB)';
  const expRent = result.self.replicas + (result.self.replicas === 1 ? ' replica' : ' replicas') + ' of ' + result.self.g + ' GPU' + (result.self.g === 1 ? '' : 's') + ' each, on ' + result.self.machines + ' machine' + (result.self.machines === 1 ? '' : 's') + ' (' + offer.gpuCount + ' x ' + gpu.name + ' per machine, ' + offer.instance + '), ' + offer.provider + weights;
  const view = buildView(result, state, data);
  assert.equal(view.self.deployment, expRent);
  assert.equal(view.assumptions.find((a) => a.label === 'Billing term').value, 'on demand');
  assert.equal(view.self.confidence, 'calibrated on measured runs, throughput band x' + gpu.band.low + ' to x' + gpu.band.high);
  const stB = normalizeState({ ...DEFAULT_STATE, mode: 'buy', buyGpu: 'rtx6000pro' }, data);
  const resB = evaluate(stB, data);
  assert.equal(resB.self.offered, true);
  const server = data.buyOptions.servers.filter((sv) => sv.gpu === 'rtx6000pro' && sv.gpuCount >= resB.self.g).sort((a, b) => a.gpuCount - b.gpuCount)[0];
  assert.equal(buildView(resB, stB, data).self.deployment, resB.self.servers + ' servers of ' + server.gpuCount + ' x ' + G['rtx6000pro'].name + weights);
});

test('view: buy assumptions carry the basis kinds', () => {
  const stB = normalizeState({ ...DEFAULT_STATE, mode: 'buy', buyGpu: 'rtx6000pro' }, data);
  const view = buildView(evaluate(stB, data), stB, data);
  const byLabel = Object.fromEntries(view.assumptions.map((a) => [a.label, a.basis]));
  for (const [label, kind] of [['Amortisation years', BASIS.amortYears.kind], ['Energy price', BASIS.electricityUsdPerKwh.kind], ['Colocation price', BASIS.coloUsdPerKwMonth.kind], ['Power usage effectiveness', BASIS.pue.kind], ['Support', BASIS.supportPctPerYear.kind]]) assert.equal(byLabel[label], kind);
  assert.ok(view.assumptions.some((a) => a.label === 'Server price') && view.assumptions.some((a) => a.label === 'Server power'));
});

test('view: error state', () => {
  const view = buildView({ ...result, errors: ['something broke'] }, state, data);
  assert.equal(view.headline, 'something broke');
  assert.equal(view.crossoverText, '');
  assert.equal(view.api.title, '');
  assert.equal(view.api.monthly, '');
  assert.equal(view.self.deployment, '');
  assert.deepEqual(view.assumptions, []);
});

// Real B1 data records under public/data/tokenomics for the assumptions rows.
const realFiles = { models: 'models.json', gpus: 'gpus.json', apiPrices: 'api_prices.json', rentOffers: 'rent_offers.json', buyOptions: 'buy_options.json' };
const realData = Object.fromEntries(Object.entries(realFiles).map(([key, file]) =>
  [key, JSON.parse(readFileSync(join(here, '../public/data/tokenomics/' + file), 'utf8'))]));

test('view: assumption rows from the real data records', () => {
  const row = (v, label) => v.assumptions.find((a) => a.label === label);
  const offer = realData.rentOffers.find((o) => o.pricePerHour < 10 && !o.addonPerHour) ?? realData.rentOffers[0];
  const stR = normalizeState({ ...DEFAULT_STATE, rentProvider: offer.provider, rentOfferId: offer.id }, realData);
  const viewR = buildView(evaluate(stR, realData), stR, realData);
  assert.equal(row(viewR, 'Machine price').value, '$' + (offer.pricePerHour + (offer.addonPerHour ?? 0)).toFixed(2) + ' per hour'); assert.equal(row(viewR, 'Machine price').basis, 'published');
  const srvBasis = (sv) => (sv.priceKind === 'list' ? 'list price' : sv.priceKind === 'retail' ? 'retail price' : 'quote');
  const powBasis = (sv) => (sv.powerKind ?? (/\bderived\b/.test(sv.note ?? '') ? 'derived' : 'published'));
  for (const [gpu, C, wantPow] of [['rtx6000pro', 1, 'derived'], ['b200', 100, 'published']]) {
    const stB = normalizeState({ ...DEFAULT_STATE, mode: 'buy', buyGpu: gpu, C }, realData);
    const rB = evaluate(stB, realData); const sv = realData.buyOptions.servers.find((x) => x.id === rB.self.serverId) ?? realData.buyOptions.servers.find((x) => x.gpu === gpu);
    const viewB = buildView(rB, stB, realData);
    assert.equal(row(viewB, 'Server price').value, fmtUsd(sv.priceUsd) + ' per server');
    assert.equal(row(viewB, 'Server price').basis, srvBasis(sv));
    assert.equal(row(viewB, 'Server power').value, sv.powerKw.toFixed(2) + ' kW per server');
    assert.equal(row(viewB, 'Server power').basis, powBasis(sv), gpu + ' power basis from powerKind'); assert.equal(row(viewB, 'Server power').basis, wantPow, gpu + ' power basis branch');
  }
});

test('view: crossover text for the real expected-speed cases', () => {
  const sWord = (n) => (n === 1 ? '1 parallel stream' : fmtInt(n) + ' parallel streams');
  // A 2,000-token context: the mid and fast ends cross, the slow end never does.
  const stD = normalizeState({ ...DEFAULT_STATE, ctx: 2000 }, realData); const rd = evaluate(stD, realData);
  assert.ok(rd.crossover.mid !== null && rd.crossover.high === null, 'case b: high null');
  const fast = rd.crossover.low === rd.crossover.mid ? 'If the GPUs run faster than expected, that point stays the same' : 'If the GPUs run faster than expected, it happens from ' + fmtInt(rd.crossover.low);
  assert.equal(buildView(rd, stD, realData).crossoverText, 'At the expected speed, self-hosting becomes cheaper from about ' + sWord(rd.crossover.mid) + '. ' + fast + "; if they run slower, it doesn't happen within 10,000 streams. Below that, the GPU would sit partly idle, so the API's pay-per-use is cheaper.");
  const stG = normalizeState({ ...DEFAULT_STATE, modelId: 'gemma-4-31b', bits: 4, apiId: 'OpenAI:gpt-6-luna', rentOfferId: 'AWS:g7e.2xlarge:on_demand', v: 30, ctx: 4000 }, realData);
  const rg = evaluate(stG, realData);
  assert.ok(rg.crossover.mid === null && rg.crossover.low !== null, 'gemma case: only the fast end crosses');
  assert.equal(buildView(rg, stG, realData).crossoverText, 'At the expected speed the API stays cheaper all the way up to 10,000 parallel streams. Self-hosting only wins from about ' + sWord(rg.crossover.low) + ' if the GPUs run faster than expected. Below that, the GPU would sit partly idle, so the API\'s pay-per-use is cheaper.');
});

test('view: server power basis from powerKind, with the note fallback', () => {
  const mk = (note, powerKind) => ({ id: 'x:test', gpu: 'rtx6000pro', gpuCount: 1, system: 'Test', priceUsd: 1000, powerKw: 1.5, priceKind: 'list', sourceUrl: null, note, powerKind });
  for (const [note, powerKind, want] of [['derived: yes', 'derived', 'derived'], ['clean', 'measured', 'measured'], ['clean', 'published', 'published'], ['derived: yes', undefined, 'derived'], ['clean', undefined, 'published']]) {
    const d2 = { ...data, buyOptions: { ...data.buyOptions, servers: [mk(note, powerKind)] } }; const stB = normalizeState({ ...DEFAULT_STATE, mode: 'buy', buyGpu: 'rtx6000pro' }, d2);
    assert.equal(buildView(evaluate(stB, d2), stB, d2).assumptions.find((a) => a.label === 'Server power').basis, want);
  }
});

test('view: assumptions use the effective workload in both modes (real data)', () => {
  const row = (v, label) => v.assumptions.find((a) => a.label === label);
  // Detailed: the average request of the loop and the largest context the loop reaches.
  const stA = normalizeState({ ...DEFAULT_STATE, shape: 'detailed' }, realData);
  const rA = evaluate(stA, realData); const viewA = buildView(rA, stA, realData);
  assert.equal(row(viewA, 'Input tokens per request').value, fmtInt(rA.workload.isl)); assert.equal(row(viewA, 'Input tokens per request').basis, 'average over the loop');
  assert.equal(row(viewA, 'Output tokens per request').value, fmtInt(rA.workload.osl)); assert.equal(row(viewA, 'Output tokens per request').basis, 'set in the controls');
  assert.equal(row(viewA, 'Cached input share').value, fmtPct(rA.workload.cachedShare)); assert.equal(row(viewA, 'Cached input share').basis, 'derived from the agent loop');
  assert.equal(row(viewA, 'Context reserved per request').value, '262,144 tokens', 'the default loop would reach 315,000 and the window caps it');
  assert.equal(row(viewA, 'Context reserved per request').basis, 'largest context the loop reaches, capped at the model window');
  const short = normalizeState({ ...DEFAULT_STATE, shape: 'detailed', agent: { c0: 10000, d: 1000, o: 500, N: 5, caching: false } }, realData);
  assert.equal(row(buildView(evaluate(short, realData), short, realData), 'Context reserved per request').value, fmtInt(10000 + 4 * 1500 + 500) + ' tokens', 'a short loop reserves what it reaches');
  // Simple: output 1,000, input the rest, nothing cached, all fixed by the mode.
  const stS = normalizeState({ ...DEFAULT_STATE, ctx: 131072 }, realData);
  const viewS = buildView(evaluate(stS, realData), stS, realData);
  assert.equal(row(viewS, 'Input tokens per request').value, '130,072'); assert.equal(row(viewS, 'Input tokens per request').basis, 'fixed in simple mode');
  assert.equal(row(viewS, 'Output tokens per request').value, '1,000'); assert.equal(row(viewS, 'Output tokens per request').basis, 'fixed in simple mode');
  assert.equal(row(viewS, 'Cached input share').value, '0%'); assert.equal(row(viewS, 'Cached input share').basis, 'fixed in simple mode');
  assert.equal(row(viewS, 'Context reserved per request').value, '131,072 tokens'); assert.equal(row(viewS, 'Context reserved per request').basis, 'reserved in full for every request (worst case)');
  assert.equal(row(viewS, 'Speed per stream').value, '30 tokens per second'); assert.equal(row(viewS, 'Speed per stream').basis, 'set in the controls');
  // The headline and the API card read the same workload as the table.
  const resS = evaluate(stS, realData);
  assert.equal(resS.workload.isl + resS.workload.osl, 131072);
  assert.equal(viewS.api.perMtok, fmtUsdSmall(resS.api.monthly.usdPerMtokOut) + ' per million output tokens');
});
