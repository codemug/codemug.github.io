// Follow-up view tests that no longer fit in tokenomics-view.test.mjs.
// Run: node --test tests/tokenomics-view2.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEFAULT_STATE, normalizeState } from '../src/lib/tokenomics/ui/state.mjs';
import { evaluate } from '../src/lib/tokenomics/ui/evaluate.mjs';
import { buildView } from '../src/lib/tokenomics/ui/view.mjs';
import { fmtInt } from '../src/lib/tokenomics/ui/format.mjs';
import * as calc from '../src/lib/tokenomics/calc.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const JR = (f) => JSON.parse(readFileSync(join(here, '../public/data/tokenomics/' + f), 'utf8'));
const real = { models: JR('models.json'), gpus: JR('gpus.json'), apiPrices: JR('api_prices.json'), rentOffers: JR('rent_offers.json'), buyOptions: JR('buy_options.json') };

test('view: cache write premium row, in every mode', () => {
  const stS = normalizeState({ ...DEFAULT_STATE }, real);
  const stA = normalizeState({ ...DEFAULT_STATE, shape: 'detailed', detail: 'loop' }, real);
  const stC = normalizeState({ ...DEFAULT_STATE, shape: 'detailed' }, real);
  for (const st of [stS, stA, stC]) {
    const view = buildView(evaluate(st, real), st, real);
    assert.deepEqual(view.assumptions.find((a) => a.label === 'Cache write premium'), { key: 'as.cachewrite', label: 'Cache write premium', value: 'not charged', basis: 'not modelled (Anthropic and OpenAI bill 1.25x on tokens written to the cache)' });
  }
});

test('view: the reserved context row, in Simple and in Detailed mode', () => {
  const st = normalizeState({ ...DEFAULT_STATE }, real);
  assert.equal(st.ctx, 262144, 'default Simple context length');
  // Simple: the context length itself is reserved for every request, in full (the worst case).
  for (const ctx of [262144, 131072, 32768, 2000]) {
    const s = normalizeState({ ...DEFAULT_STATE, ctx }, real);
    const res = evaluate(s, real);
    const row = buildView(res, s, real).assumptions.find((a) => a.key === 'as.ctx');
    assert.equal(row.label, 'Context reserved per request');
    assert.equal(row.basis, 'reserved in full for every request (worst case)');
    assert.equal(row.value, fmtInt(ctx) + ' tokens');
    assert.ok(Math.abs(res.workload.isl + res.workload.osl - ctx) < 1e-6, 'input plus output is the context length');
    assert.equal(res.workload.reserved, ctx);
  }
  // Detailed, custom split: the context length is reserved in full too, as in Simple.
  const c = normalizeState({ ...DEFAULT_STATE, shape: 'detailed', ctx: 50000 }, real);
  const crow = buildView(evaluate(c, real), c, real).assumptions.find((a) => a.key === 'as.ctx');
  assert.equal(crow.value, '50,000 tokens');
  assert.equal(crow.basis, 'reserved in full for every request (worst case)');
  // Detailed, agent loop: the largest context the loop reaches, capped at the model window.
  const d = normalizeState({ ...DEFAULT_STATE, shape: 'detailed', detail: 'loop' }, real);
  const drow = buildView(evaluate(d, real), d, real).assumptions.find((a) => a.key === 'as.ctx');
  assert.equal(drow.value, '262,144 tokens');
  assert.equal(drow.basis, 'largest context the loop reaches, capped at the model window');
});

test('view: every assumptions row has a unique overlay key, in rent and buy mode', () => {
  for (const s of [normalizeState({ ...DEFAULT_STATE }, real), normalizeState({ ...DEFAULT_STATE, mode: 'buy' }, real)]) {
    const keys = buildView(evaluate(s, real), s, real).assumptions.map((a) => a.key);
    assert.ok(keys.every((k) => /^as\.[a-z]+$/.test(k)), keys.join());
    assert.equal(new Set(keys).size, keys.length);
  }
});

test('view: requests per replica line, with and without the speed met', () => {
  const line = (patch) => { const st = normalizeState({ ...DEFAULT_STATE, ...patch }, real); const res = evaluate(st, real); const v = buildView(res, st, real); return { res, v }; };
  // Simple default: each request reserves the whole 262,144-token window, so one request fills a replica; with 80% of
  // the context cached one GPU alone reaches about 34 tokens per second, so the 30 asked for is met (it was missed, at
  // 17, when a request was a 261k-token prompt with nothing cached).
  const d = line({});
  assert.equal(d.res.self.Bv, 1); assert.equal(d.res.self.meetsSpeed, true);
  assert.equal(d.v.self.perReplica, 'Requests per replica: 1 at 30 tokens per second');
  assert.deepEqual(d.v.self.notes, []);
  assert.equal(d.v.self.speedMissed, false);
  // A shorter context shares a replica: 9 requests at 32,768 tokens.
  const s32 = line({ ctx: 32768 });
  assert.equal(s32.res.self.meetsSpeed, true); assert.equal(s32.res.self.Bv, 9);
  assert.equal(s32.v.self.perReplica, 'Requests per replica: 9 at 30 tokens per second');
  assert.deepEqual(s32.v.self.notes, []);
  assert.equal(s32.v.self.speedMissed, false);
  // Detailed default (custom split) is the same workload as Simple; the cached agent loop meets the speed with one request per replica.
  assert.equal(line({ shape: 'detailed' }).v.self.perReplica, d.v.self.perReplica);
  const det = line({ shape: 'detailed', detail: 'loop' });
  assert.equal(det.res.self.meetsSpeed, true);
  assert.equal(det.v.self.perReplica, 'Requests per replica: ' + det.res.self.Bv + ' at 30 tokens per second');
  // Asking for more than one request alone can do: the speed is missed and the card says so.
  const missed = line({ v: 500 });
  assert.equal(missed.res.self.meetsSpeed, false); assert.equal(missed.res.self.Bv, 1);
  assert.equal(missed.v.self.perReplica, 'Requests per replica: 1 (even one request is slower than 500 tokens per second)');
  assert.deepEqual(missed.v.self.notes, [], 'the card says it with a label and the page with a warning, not with a note');
  assert.equal(missed.v.self.speedMissed, true);
  const slow = line({ ctx: 2000, v: 500 });
  assert.equal(slow.res.self.meetsSpeed, false);
  assert.equal(slow.v.self.perReplica, 'Requests per replica: 1 (even one request is slower than 500 tokens per second)');
  const k = line({ modelId: 'kimi-k3.1-pro', rentProvider: 'AWS', rentOfferId: 'AWS:g7e.2xlarge:on_demand' });
  assert.equal(k.res.self.offered, false);
  assert.equal(k.v.self.perReplica, '');
});

// The speed one request alone reaches, worked out here from the step model and the data.
function soloSpeed(st, res) {
  const model = real.models.find((m) => m.id === st.modelId);
  const gpu = real.gpus.find((g) => g.id === real.rentOffers.find((o) => o.id === st.rentOfferId).gpu);
  return calc.stepModel(model, st.bits, gpu, res.self.g, res.workload.isl, res.workload.osl, 1, { cachedShare: res.workload.cachedShare, ctx: res.workload.reserved }).userTokS;
}

test('warning: plain English under the headline exactly when the speed asked for is missed', () => {
  const at = (patch) => { const st = normalizeState({ ...DEFAULT_STATE, ...patch }, real); const res = evaluate(st, real); return { st, res, v: buildView(res, st, real) }; };
  // Simple default: 80% cached, so one GPU alone reaches 34 tokens per second and the 30 asked for is met: no warning.
  const d = at({});
  assert.equal(d.res.self.offered, true); assert.equal(d.res.self.meetsSpeed, true);
  assert.equal(Math.round(soloSpeed(d.st, d.res)), 34);
  assert.equal(d.res.self.soloTokS, soloSpeed(d.st, d.res), 'evaluate reports the speed of one lone request');
  assert.equal(d.v.warning, '');
  // Asking for 500 tokens per second is missed: one GPU reaches about 34.
  const x = at({ v: 500 });
  assert.equal(x.res.self.meetsSpeed, false);
  assert.equal(Math.round(soloSpeed(x.st, x.res)), 34);
  assert.equal(x.res.self.soloTokS, soloSpeed(x.st, x.res));
  assert.equal(x.v.warning, 'One GPU reaches only about 34 tokens per second on these requests, not the 500 you asked for. The self-hosting figure gives every stream its own GPU and the speed is still missed. Lower the speed per stream or pick a faster GPU.');
  // A shorter context meets the speed: no warning.
  const s32 = at({ ctx: 32768 });
  assert.equal(s32.res.self.meetsSpeed, true); assert.equal(s32.v.warning, '');
  assert.ok(s32.res.self.soloTokS >= 30);
  // The same Simple default asked for 10 tokens per second is met.
  assert.equal(at({ v: 10 }).v.warning, '');
  // The text follows the speed asked for and the number of GPUs in a replica.
  const fast = at({ v: 500, ctx: 2000 });
  assert.equal(fast.res.self.meetsSpeed, false);
  assert.match(fast.v.warning, /^One GPU reaches only about 47 tokens per second on these requests, not the 500 you asked for\./);
  const flash = at({ modelId: 'qwen3.8-flash-next', rentOfferId: 'AWS:g7e.12xlarge:on_demand', v: 500 });
  assert.equal(flash.res.self.g, 2);
  assert.match(flash.v.warning, /^One replica \(2 GPUs\) reaches only about \d+ tokens per second on these requests, not the 500 you asked for\. The self-hosting figure gives every stream its own replica and the speed is still missed\./);
  // Never when self-hosting is not offered, and never an empty claim.
  const none = at({ modelId: 'kimi-k3.1-pro', rentProvider: 'AWS', rentOfferId: 'AWS:g7e.2xlarge:on_demand' });
  assert.equal(none.res.self.offered, false); assert.equal(none.v.warning, ''); assert.equal(none.v.self.speedMissed, false);
  assert.equal(none.res.self.soloTokS, null);
  for (const patch of [{}, { ctx: 32768 }, { shape: 'detailed' }, { shape: 'detailed', detail: 'loop' }, { v: 500 }, { C: 0.05, ctx: 2000 }]) {
    const t = at(patch);
    assert.equal(!/reaches only about/.test(t.v.warning), t.res.self.meetsSpeed !== false, 'speed warning exactly when the speed is missed: ' + JSON.stringify(patch));
    assert.equal(t.v.self.speedMissed, t.res.self.meetsSpeed === false);
  }
});

test('warning: not part of the error view', () => {
  const st = normalizeState({ ...DEFAULT_STATE }, real);
  const v = buildView({ ...evaluate(st, real), errors: ['broken'] }, st, real);
  assert.equal(v.warning, ''); assert.equal(v.self.speedMissed, false);
});

test('view: an agent loop that reaches past the model window says so, and a simple workload does not', async () => {
  const { readFileSync } = await import('node:fs');
  const { normalizeState, DEFAULT_STATE } = await import('../src/lib/tokenomics/ui/state.mjs');
  const { evaluate } = await import('../src/lib/tokenomics/ui/evaluate.mjs');
  const { buildView } = await import('../src/lib/tokenomics/ui/view.mjs');
  const rd = (f) => JSON.parse(readFileSync(new URL('../public/data/tokenomics/' + f, import.meta.url), 'utf8'));
  const d = { models: rd('models.json'), gpus: rd('gpus.json'), apiPrices: rd('api_prices.json'), rentOffers: rd('rent_offers.json'), buyOptions: rd('buy_options.json'), meta: rd('meta.json') };
  const view = (over) => { const st = normalizeState({ ...DEFAULT_STATE, ...over }, d); return buildView(evaluate(st, d), st, d).warning; };
  // the default 50-turn loop reaches 20,000 + 49 x 6,000 + 1,000 = 315,000 tokens, past Qwen3.8 27B's 262,144
  assert.match(view({ shape: 'detailed', detail: 'loop' }), /This loop reaches 315,000 tokens, past the 262,144-token window of Qwen3\.8 27B\./);
  assert.doesNotMatch(view({ shape: 'detailed', detail: 'loop', agent: { c0: 20000, d: 5000, o: 1000, N: 10, caching: true } }), /This loop reaches/);
  assert.doesNotMatch(view({ shape: 'simple', ctx: 32768 }), /This loop reaches/);
  // The agent loop fields are kept when the reader picks the custom split, but they say nothing then.
  assert.doesNotMatch(view({ shape: 'detailed', detail: 'split' }), /This loop reaches/);
});
