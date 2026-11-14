// The two workload modes (workload.mjs) and the note for a context length the
// page had to change (ctx-note.mjs). Real data files, no browser.
// Run: node --test tests/tokenomics-workload.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { workloadFor, ctxBounds, SIMPLE_OSL, MIN_CTX } from '../src/lib/tokenomics/ui/workload.mjs';
import { ctxClampNote } from '../src/lib/tokenomics/ui/ctx-note.mjs';
import { DEFAULT_STATE, normalizeState } from '../src/lib/tokenomics/ui/state.mjs';
import { evaluate } from '../src/lib/tokenomics/ui/evaluate.mjs';
import { buildView } from '../src/lib/tokenomics/ui/view.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const rd = (f) => JSON.parse(readFileSync(join(here, '../public/data/tokenomics/' + f), 'utf8'));
const data = { models: rd('models.json'), gpus: rd('gpus.json'), apiPrices: rd('api_prices.json'), rentOffers: rd('rent_offers.json'), buyOptions: rd('buy_options.json'), meta: rd('meta.json') };
const modelOf = (id) => data.models.find((m) => m.id === id);
const norm = (s) => normalizeState({ ...DEFAULT_STATE, ...s }, data);

test('Simple: every request holds ctx tokens, 1,000 of them output, nothing cached, ctx reserved', () => {
  assert.equal(SIMPLE_OSL, 1000); assert.equal(MIN_CTX, 2000);
  for (const ctx of [2000, 2001, 50000, 131072, 262144]) {
    const w = workloadFor(norm({ ctx }), modelOf('qwen3.8-27b'));
    assert.deepEqual(w, { isl: ctx - 1000, osl: 1000, cachedShare: 0, reserved: ctx });
    assert.equal(w.isl + w.osl, ctx, 'input plus output is exactly the context length');
  }
});

test('Detailed: the average request of the loop, memory for the largest context it reaches, capped at the window', () => {
  const loop = { c0: 20000, d: 5000, o: 1000, N: 50, caching: true };
  const w = workloadFor(norm({ shape: 'detailed', agent: loop }), modelOf('qwen3.8-27b'));
  assert.equal(w.isl, 20000 + (49 * 6000) / 2);
  assert.equal(w.osl, 1000);
  assert.ok(Math.abs(w.cachedShare - (1 - 6000 / w.isl)) < 1e-12, 'the cached share of today\'s derivation');
  assert.equal(w.reserved, 262144, 'the loop would reach 315,000 and the 262,144 window caps it');
  // A model with a bigger window keeps what the loop reaches: c0 + (N - 1) x (d + o) + o.
  assert.equal(workloadFor(norm({ shape: 'detailed', agent: loop }), modelOf('kimi-k3.1-pro')).reserved, 20000 + 49 * 6000 + 1000);
  // No caching: nothing is cached, whatever the loop.
  assert.equal(workloadFor(norm({ shape: 'detailed', agent: { ...loop, caching: false } }), modelOf('qwen3.8-27b')).cachedShare, 0);
  // One turn: the context is the first context plus the answer.
  assert.equal(workloadFor(norm({ shape: 'detailed', agent: { c0: 5000, d: 100, o: 300, N: 1, caching: true } }), modelOf('qwen3.8-27b')).reserved, 5300);
  // The Simple field plays no part in Detailed.
  assert.deepEqual(workloadFor(norm({ shape: 'detailed', ctx: 3000 }), modelOf('qwen3.8-27b')), workloadFor(norm({ shape: 'detailed', ctx: 262144 }), modelOf('qwen3.8-27b')));
});

test('evaluate passes the reserved context to the sizing: a longer context needs more room per request', () => {
  const at = (ctx) => evaluate(norm({ ctx }), data);
  const small = at(2000); const big = at(262144);
  assert.deepEqual(small.errors, []); assert.deepEqual(big.errors, []);
  assert.deepEqual(small.workload, { isl: 1000, osl: 1000, cachedShare: 0, reserved: 2000 });
  assert.ok(small.self.Bv > big.self.Bv, 'short requests share a replica, long ones do not');
  assert.ok(small.api.monthly.usdPerMonth < big.api.monthly.usdPerMonth, 'the API bills the longer prompt');
  assert.equal(evaluate(norm({ shape: 'detailed' }), data).workload.reserved, 262144);
});

test('ctxBounds: the floor and the model window', () => {
  assert.deepEqual(ctxBounds(modelOf('qwen3.8-27b')), [2000, 262144]);
  assert.deepEqual(ctxBounds(modelOf('kimi-k3.1-pro')), [2000, 1048576]);
  assert.deepEqual(ctxBounds({ contextMax: 1000 }), [2000, 2000]);
});

test('ctx note: says so when the number was capped at the window or raised to the floor', () => {
  const ask = (patch, opts) => { const merged = { ...DEFAULT_STATE, ...patch }; return ctxClampNote(merged, normalizeState(merged, data), data, opts); };
  assert.equal(ask({}), null, 'nothing changed');
  assert.equal(ask({ ctx: 50000 }), null);
  assert.equal(ask({ ctx: 262144, modelId: 'kimi-k3.1-pro' }), null);
  // Switching to a model with a smaller window than the typed length (Qwen3.8 27B has 262,144).
  assert.equal(ask({ ctx: 1048576, modelId: 'qwen3.8-27b' }), 'Context length capped at 262,144 tokens, the window of Qwen3.8 27B.');
  assert.equal(ask({ ctx: 900000, modelId: 'gemma-4-31b' }), 'Context length capped at 262,144 tokens, the window of Gemma 4 31B.');
  assert.equal(ask({ ctx: 500 }), 'Context length raised to 2,000 tokens, the smallest the calculator allows.');
  assert.equal(ask({ ctx: 500 }, { quiet: true }), null, 'quiet: a number still being typed is not corrected aloud');
  assert.equal(ask({ ctx: 1048576, modelId: 'qwen3.8-27b' }, { quiet: true }), 'Context length capped at 262,144 tokens, the window of Qwen3.8 27B.', 'quiet only hides the floor note');
  assert.equal(ask({ ctx: 1048576, shape: 'detailed' }), null, 'Detailed does not use the field');
  assert.equal(ask({ ctx: undefined }), null);
  assert.equal(ask({ ctx: NaN }), null);
});

test('API side: headline, cards and table read the same effective workload in both modes', () => {
  for (const patch of [{}, { ctx: 131072 }, { ctx: 32768 }, { shape: 'detailed' }]) {
    const st = norm(patch);
    const res = evaluate(st, data);
    const view = buildView(res, st, data);
    const w = res.workload;
    const row = (label) => view.assumptions.find((a) => a.label === label);
    assert.equal(row('Input tokens per request').value, w.isl.toLocaleString('en-US'));
    assert.equal(row('Output tokens per request').value, w.osl.toLocaleString('en-US'));
    assert.equal(row('Context reserved per request').value, w.reserved.toLocaleString('en-US') + ' tokens');
    assert.equal(row('Cached input share').value, Math.round(w.cachedShare * 100) + '%');
    assert.equal(row('Speed per stream').value, st.v + ' tokens per second');
    // The API cost is the cost of exactly that request.
    const price = data.apiPrices.find((p) => p.id === st.apiId);
    const perRequest = (w.isl * (1 - w.cachedShare) * price.input + w.isl * w.cachedShare * (price.cachedInput ?? price.input) + w.osl * price.output) / 1e6;
    const secondsPerRequest = w.osl / st.v + st.ttftS;
    const monthly = ((3600 * st.C) / secondsPerRequest) * perRequest * st.hoursPerDay * 30.4;
    assert.ok(Math.abs(res.api.monthly.usdPerMonth - monthly) / monthly < 1e-9, 'API monthly for ' + JSON.stringify(patch));
    assert.ok(view.headline.includes('API costs'));
  }
});
