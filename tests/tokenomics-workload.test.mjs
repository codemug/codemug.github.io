// The workload modes (workload.mjs): Simple (80% cached input, 10% new input, 10%
// output of the context), Detailed "Custom split" (the same split, set by the
// reader) and Detailed "Agent loop"; their state and links (state.mjs), and the
// notes for numbers the page had to change (ctx-note.mjs). Real data files, no browser.
// Run: node --test tests/tokenomics-workload.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { workloadFor, splitWorkload, ctxBounds, simpleSplitText, SIMPLE_SPLIT, MIN_CTX } from '../src/lib/tokenomics/ui/workload.mjs';
import { ctxClampNote, splitClampNote, workloadNote } from '../src/lib/tokenomics/ui/ctx-note.mjs';
import { DEFAULT_STATE, normalizeState, normalizeSplit, toHash, fromHash } from '../src/lib/tokenomics/ui/state.mjs';
import { evaluate } from '../src/lib/tokenomics/ui/evaluate.mjs';
import { buildView } from '../src/lib/tokenomics/ui/view.mjs';
import { fmtShare } from '../src/lib/tokenomics/ui/format.mjs';
import * as calc from '../src/lib/tokenomics/calc.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const rd = (f) => JSON.parse(readFileSync(join(here, '../public/data/tokenomics/' + f), 'utf8'));
const data = { models: rd('models.json'), gpus: rd('gpus.json'), apiPrices: rd('api_prices.json'), rentOffers: rd('rent_offers.json'), buyOptions: rd('buy_options.json'), meta: rd('meta.json') };
const modelOf = (id) => data.models.find((m) => m.id === id);
const norm = (s) => normalizeState({ ...DEFAULT_STATE, ...s }, data);
const near = (a, b, msg) => assert.ok(Math.abs(a - b) <= Math.max(1e-9, Math.abs(b) * 1e-12), msg + ': ' + a + ' vs ' + b);
const qwen = modelOf('qwen3.8-27b');

test('Simple: 80% of the context is cached input, 10% new input, 10% output, the whole context reserved', () => {
  assert.deepEqual(SIMPLE_SPLIT, { cachedPct: 80, outputPct: 10 }); assert.equal(MIN_CTX, 2000);
  assert.equal(simpleSplitText(), '80% cached input, 10% new input and 10% output');
  for (const ctx of [2000, 2001, 50000, 131072, 262144]) {
    const w = workloadFor(norm({ ctx }), qwen);
    near(w.isl, 0.9 * ctx, 'input is 90% of the context'); near(w.osl, 0.1 * ctx, 'output is 10%');
    near(w.cachedShare, 0.8 / 0.9, 'the cached share of the INPUT is 0.8 / 0.9');
    assert.equal(w.reserved, ctx);
    near(w.isl * w.cachedShare, 0.8 * ctx, 'cached tokens are 80% of the context');
    near(w.isl * (1 - w.cachedShare), 0.1 * ctx, 'new input tokens are 10% of the context');
    near(w.isl + w.osl, ctx, 'input plus output is the context length');
    assert.deepEqual(w.mix, { cachedPct: 80, newPct: 10, outputPct: 10 });
  }
  // Fractional inside, whole tokens on the page.
  const w = workloadFor(norm({}), qwen);
  assert.equal(w.isl, 0.9 * 262144); assert.equal(w.osl, 0.1 * 262144);
  assert.ok(!Number.isInteger(w.isl) && !Number.isInteger(w.osl), 'not rounded: ' + w.isl + ', ' + w.osl);
  assert.equal(DEFAULT_STATE.ctx, 262144);
});

test("the author's formula equals calc.apiCostPerRequest, and the API bill stays linear in parallel streams", () => {
  const price = data.apiPrices.find((p) => p.id === 'Anthropic:claude-sonnet-5-5');
  assert.deepEqual([price.cachedInput, price.input, price.output], [0.1, 2, 10]);
  const L = 262144;
  const w = workloadFor(norm({ ctx: L, apiId: price.id }), qwen);
  const authors = (0.8 * L * price.cachedInput + 0.1 * L * price.input + 0.1 * L * price.output) / 1e6;
  near(calc.apiCostPerRequest(price, w.isl, w.osl, w.cachedShare), authors, 'cost per request');
  assert.equal(authors.toFixed(4), '0.3355', 'about $0.3355 per request');
  // The same cost through evaluate: requests per hour x cost per request x hours x days.
  const st = norm({ apiId: price.id, C: 3 });
  const res = evaluate(st, data);
  const perHour = (3600 * 3) / (res.workload.osl / st.v + st.ttftS);
  near(res.api.monthly.usdPerMonth, perHour * authors * st.hoursPerDay * 30.4, 'API monthly');
  // Linear: 3 streams times 5/3 is 5 streams, in every mode.
  for (const patch of [{}, { shape: 'detailed', split: { cachedPct: 20, outputPct: 30 } }, { shape: 'detailed', detail: 'loop' }]) {
    const at = (C) => evaluate(norm({ apiId: price.id, C, ...patch }), data).api.monthly.usdPerMonth;
    near(at(3) * (5 / 3), at(5), 'linear in streams for ' + JSON.stringify(patch));
  }
});

test('Custom split: the defaults are Simple; edited and edge values follow the percentages of the context', () => {
  const ctx = 262144;
  const simple = workloadFor(norm({ ctx }), qwen);
  const dflt = workloadFor(norm({ shape: 'detailed', ctx }), qwen);
  assert.deepEqual(dflt, simple, 'Detailed opens on the same request as Simple');
  // 20% cached, 10% output (the author-style example): the new input is 70% of the context.
  const w = workloadFor(norm({ shape: 'detailed', ctx, split: { cachedPct: 20, outputPct: 10 } }), qwen);
  near(w.isl, 0.9 * ctx, 'input'); near(w.osl, 0.1 * ctx, 'output'); near(w.cachedShare, 0.2 / 0.9, 'cached share');
  near(w.isl * (1 - w.cachedShare), 0.7 * ctx, 'new input is what the cached input and the output leave');
  assert.deepEqual(w.mix, { cachedPct: 20, newPct: 70, outputPct: 10 });
  assert.equal(w.reserved, ctx, 'memory is reserved for the whole context, as in Simple');
  // Another split: 25% cached, 50% output.
  const h = workloadFor(norm({ shape: 'detailed', ctx: 100000, split: { cachedPct: 25, outputPct: 50 } }), qwen);
  near(h.isl, 50000, 'isl'); near(h.osl, 50000, 'osl'); near(h.cachedShare, 0.5, 'cached share'); assert.equal(h.reserved, 100000);
  // Edges: nothing cached; no new input at all (cached + output = 100); the largest output (99).
  assert.equal(workloadFor(norm({ shape: 'detailed', split: { cachedPct: 0, outputPct: 10 } }), qwen).cachedShare, 0);
  const full = workloadFor(norm({ shape: 'detailed', split: { cachedPct: 90, outputPct: 10 } }), qwen);
  near(full.cachedShare, 1, 'all the input is cached'); assert.equal(full.mix.newPct, 0);
  const big = workloadFor(norm({ shape: 'detailed', ctx: 100000, split: { cachedPct: 0, outputPct: 99 } }), qwen);
  near(big.osl, 99000, 'osl'); near(big.isl, 1000, 'isl: one percent of the context is still input'); assert.ok(big.isl > 0);
  const tiny = workloadFor(norm({ shape: 'detailed', ctx: 2000, split: { cachedPct: 80, outputPct: 0.1 } }), qwen);
  near(tiny.osl, 2, 'at least a token or two of output at the smallest share'); assert.ok(tiny.osl >= 1);
  // The pure function takes the percentages directly.
  const sp = splitWorkload(1000, { cachedPct: 50, outputPct: 20 });
  near(sp.isl, 800, 'isl'); near(sp.osl, 200, 'osl'); near(sp.cachedShare, 0.625, 'cached share'); assert.equal(sp.reserved, 1000);
  assert.deepEqual(sp.mix, { cachedPct: 50, newPct: 30, outputPct: 20 });
  // The cost and the sizing accept all of these without error.
  for (const split of [{ cachedPct: 0, outputPct: 99 }, { cachedPct: 90, outputPct: 10 }, { cachedPct: 0, outputPct: 0.1 }, { cachedPct: 99.9, outputPct: 0.1 }]) {
    assert.deepEqual(evaluate(norm({ shape: 'detailed', split }), data).errors, [], JSON.stringify(split));
  }
});

test('Agent loop: exactly the loop of before, the memory rule and the loop fields untouched', () => {
  const loop = { c0: 20000, d: 5000, o: 1000, N: 50, caching: true };
  const w = workloadFor(norm({ shape: 'detailed', detail: 'loop', agent: loop }), qwen);
  assert.equal(w.isl, 20000 + (49 * 6000) / 2);
  assert.equal(w.osl, 1000);
  assert.ok(Math.abs(w.cachedShare - (1 - 6000 / w.isl)) < 1e-12, "the cached share of today's derivation");
  assert.equal(w.reserved, 262144, 'the loop would reach 315,000 and the 262,144 window caps it');
  assert.equal(w.mix, null, 'a loop has no split of the context');
  assert.deepEqual({ ...w, mix: undefined }, { ...calc.agentLoop(loop), reserved: 262144, mix: undefined });
  // A model with a bigger window keeps what the loop reaches: c0 + (N - 1) x (d + o) + o.
  assert.equal(workloadFor(norm({ shape: 'detailed', detail: 'loop', agent: loop }), modelOf('kimi-k3.1-pro')).reserved, 20000 + 49 * 6000 + 1000);
  // No caching: nothing is cached, whatever the loop.
  assert.equal(workloadFor(norm({ shape: 'detailed', detail: 'loop', agent: { ...loop, caching: false } }), qwen).cachedShare, 0);
  // One turn: the context is the first context plus the answer.
  assert.equal(workloadFor(norm({ shape: 'detailed', detail: 'loop', agent: { c0: 5000, d: 100, o: 300, N: 1, caching: true } }), qwen).reserved, 5300);
  // The context length and the percentages play no part in the loop.
  const a = workloadFor(norm({ shape: 'detailed', detail: 'loop', ctx: 3000, split: { cachedPct: 5, outputPct: 50 } }), qwen);
  assert.deepEqual(a, workloadFor(norm({ shape: 'detailed', detail: 'loop', ctx: 262144 }), qwen));
});

test('evaluate passes the reserved context to the sizing: a longer context needs more room per request', () => {
  const at = (ctx) => evaluate(norm({ ctx }), data);
  const small = at(2000); const big = at(262144);
  assert.deepEqual(small.errors, []); assert.deepEqual(big.errors, []);
  near(small.workload.isl, 1800, 'isl'); near(small.workload.osl, 200, 'osl'); near(small.workload.cachedShare, 0.8 / 0.9, 'cached'); assert.equal(small.workload.reserved, 2000);
  assert.ok(small.self.Bv > big.self.Bv, 'short requests share a replica, long ones do not');
  assert.ok(small.api.monthly.usdPerMonth < big.api.monthly.usdPerMonth, 'the API bills the longer prompt');
  assert.equal(evaluate(norm({ shape: 'detailed', detail: 'loop' }), data).workload.reserved, 262144);
  assert.equal(evaluate(norm({ shape: 'detailed', ctx: 50000 }), data).workload.reserved, 50000, 'the custom split reserves its context length');
});

test('ctxBounds: the floor and the model window', () => {
  assert.deepEqual(ctxBounds(modelOf('qwen3.8-27b')), [2000, 262144]);
  assert.deepEqual(ctxBounds(modelOf('kimi-k3.1-pro')), [2000, 1048576]);
  assert.deepEqual(ctxBounds({ contextMax: 1000 }), [2000, 2000]);
});

test('state: the split is clamped to 0.1 to 99 for the output and 0 to what is left for the cached input, one decimal', () => {
  assert.equal(DEFAULT_STATE.detail, 'split'); assert.deepEqual(DEFAULT_STATE.split, { cachedPct: 80, outputPct: 10 });
  const sp = (split) => norm({ shape: 'detailed', split }).split;
  assert.deepEqual(sp({ cachedPct: 20, outputPct: 10 }), { cachedPct: 20, outputPct: 10 });
  assert.deepEqual(sp({ cachedPct: 33.33, outputPct: 12.34 }), { cachedPct: 33.3, outputPct: 12.3 }, 'one decimal');
  assert.deepEqual(sp({ cachedPct: 50, outputPct: 150 }), { cachedPct: 1, outputPct: 99 }, 'output at most 99, and the cached input fits next to it');
  assert.deepEqual(sp({ cachedPct: 0, outputPct: 0 }), { cachedPct: 0, outputPct: 0.1 }, 'output at least 0.1');
  assert.deepEqual(sp({ cachedPct: 0, outputPct: -5 }), { cachedPct: 0, outputPct: 0.1 });
  assert.deepEqual(sp({ cachedPct: -20, outputPct: 10 }), { cachedPct: 0, outputPct: 10 }, 'cached at least 0');
  assert.deepEqual(sp({ cachedPct: 100, outputPct: 10 }), { cachedPct: 90, outputPct: 10 }, 'cached + output at most 100');
  assert.deepEqual(sp({ cachedPct: 95, outputPct: 30 }), { cachedPct: 70, outputPct: 30 });
  for (const junk of [undefined, null, {}, { cachedPct: 'x' }, { cachedPct: NaN, outputPct: NaN }, 'banana', 5]) assert.deepEqual(normalizeSplit(junk), { cachedPct: 80, outputPct: 10 }, 'junk ' + JSON.stringify(junk));
  assert.deepEqual(normalizeSplit({ outputPct: 40 }), { cachedPct: 60, outputPct: 40 }, 'a missing share is the default, then fitted: 80 does not fit next to 40');
  // Idempotent.
  for (const s of [{ cachedPct: 20, outputPct: 10 }, { cachedPct: 1, outputPct: 99 }, { cachedPct: 0, outputPct: 0.1 }]) assert.deepEqual(normalizeSplit(s), s);
  // The detail: split by default, loop for the loop, anything else the split.
  assert.equal(norm({ shape: 'detailed' }).detail, 'split'); assert.equal(norm({ shape: 'detailed', detail: 'loop' }).detail, 'loop');
  assert.equal(norm({ shape: 'detailed', detail: 'banana' }).detail, 'split'); assert.equal(normalizeState({ shape: 'agent' }, data).detail, 'loop', 'the old name of the loop, when nothing else says');
  assert.equal(normalizeState({ shape: 'agent', detail: 'split' }, data).detail, 'split');
});

test('state: switching Simple to Detailed keeps the context length, and the loop keeps its own fields', () => {
  const simple = norm({ ctx: 50000 });
  const detailed = normalizeState({ ...simple, shape: 'detailed' }, data);
  assert.equal(detailed.ctx, 50000); assert.equal(detailed.detail, 'split');
  assert.equal(normalizeState({ ...detailed, shape: 'simple' }, data).ctx, 50000, 'and back again');
  const loop = normalizeState({ ...detailed, detail: 'loop' }, data);
  assert.equal(loop.ctx, 50000, 'the loop does not use the field, it keeps the value');
  assert.deepEqual(loop.agent, DEFAULT_STATE.agent);
  assert.deepEqual(normalizeState({ ...loop, detail: 'split' }, data).split, DEFAULT_STATE.split);
});

test('links: detail=loop, sc and so are written only when they matter; ctx for Simple and the custom split, not the loop', () => {
  const d = norm({});
  assert.equal(toHash(d), toHash(norm({ shape: 'simple' })));
  for (const bad of ['detail=', 'sc=', 'so=', 'a_c0=']) assert.ok(!toHash(d).includes(bad), bad + ' is not in the default link: ' + toHash(d));
  assert.ok(/ctx=262144/.test(toHash(d)) && /shape=simple/.test(toHash(d)));
  // Custom split: ctx and the percentages that differ from the defaults; no loop fields.
  const c = norm({ shape: 'detailed', ctx: 50000, split: { cachedPct: 20, outputPct: 10 } });
  const hc = toHash(c);
  assert.ok(/shape=detailed/.test(hc) && /ctx=50000/.test(hc) && /sc=20/.test(hc), hc);
  assert.ok(!/so=/.test(hc) && !/detail=/.test(hc) && !/a_c0/.test(hc), 'only what differs from the defaults: ' + hc);
  // 80% cached does not fit next to 30% output, so it is 70 and both differ from the defaults.
  const h30 = toHash(norm({ shape: 'detailed', split: { cachedPct: 80, outputPct: 30 } }));
  assert.ok(/sc=70/.test(h30) && /so=30/.test(h30), h30);
  // Agent loop: detail=loop and the a_* fields, no ctx, no percentages.
  const l = norm({ shape: 'detailed', detail: 'loop', ctx: 50000, split: { cachedPct: 20, outputPct: 10 } });
  const hl = toHash(l);
  assert.ok(/detail=loop/.test(hl) && /a_c0=20000/.test(hl) && /a_caching=true/.test(hl), hl);
  assert.ok(!/ctx=/.test(hl), 'no ctx in a loop link: ' + hl);
  // Simple writes no loop fields; the percentages are kept when they differ, for when the reader opens Detailed.
  const hs = toHash(norm({ ctx: 50000, detail: 'loop', split: { cachedPct: 20, outputPct: 30 } }));
  assert.ok(!/detail=|a_c0/.test(hs) && /sc=20/.test(hs) && /so=30/.test(hs) && /ctx=50000/.test(hs), hs);
  // Round trips: the identity on the fields that are written (ctx is not written for the loop).
  const rt = (st) => normalizeState({ ...DEFAULT_STATE, ...fromHash('#' + toHash(st)) }, data);
  assert.deepEqual(rt(d), d);
  assert.deepEqual(rt(c), c);
  assert.deepEqual(rt(norm({ shape: 'detailed', ctx: 2000, split: { cachedPct: 0, outputPct: 99 } })), norm({ shape: 'detailed', ctx: 2000, split: { cachedPct: 0, outputPct: 99 } }));
  assert.deepEqual(rt(l), { ...l, ctx: DEFAULT_STATE.ctx });
  const mixed = norm({ shape: 'detailed', detail: 'loop', agent: { c0: 30000, d: 2000, o: 500, N: 10, caching: false } });
  assert.deepEqual(rt(mixed), { ...mixed, ctx: DEFAULT_STATE.ctx });
});

test('links: older links still open, and junk falls back to the defaults', () => {
  const old = 'a_c0=20000&a_d=5000&a_o=1000&a_N=50&a_caching=true&C=100&v=30&hoursPerDay=12&modelId=qwen3.8-27b&bits=4&ctx=32768&mode=rent';
  const open = (hash) => normalizeState({ ...DEFAULT_STATE, ...fromHash(hash) }, data);
  // shape=agent opens the agent loop, as it always did.
  const agent = open('#shape=agent&' + old);
  assert.equal(agent.shape, 'detailed'); assert.equal(agent.detail, 'loop'); assert.equal(agent.agent.c0, 20000);
  // shape=detailed with an a_* parameter and no detail opens the loop; so does a single a_* parameter.
  assert.equal(open('#shape=detailed&' + old).detail, 'loop');
  assert.equal(open('#shape=detailed&a_N=12').detail, 'loop'); assert.equal(open('#shape=detailed&a_N=12').agent.N, 12);
  assert.equal(open('#shape=detailed&a_caching=false').detail, 'loop');
  // shape=detailed with nothing about the loop opens the custom split.
  const split = open('#shape=detailed&ctx=40000&C=10');
  assert.equal(split.detail, 'split'); assert.equal(split.ctx, 40000); assert.deepEqual(split.split, { cachedPct: 80, outputPct: 10 });
  assert.equal(open('#shape=detailed').detail, 'split');
  // An explicit detail wins over the a_* parameters.
  assert.equal(open('#shape=detailed&detail=split&a_c0=20000').detail, 'split');
  assert.equal(open('#shape=detailed&detail=loop').detail, 'loop');
  // shape=single is Simple, and the old isl, osl and cachedShare parameters are ignored, as before.
  const single = fromHash('#shape=single&isl=4000&osl=500&cachedShare=0.5&ctx=32768');
  assert.deepEqual(single, { shape: 'simple', ctx: 32768 });
  assert.equal(open('#shape=single&isl=4000&osl=500&cachedShare=0.5&ctx=32768').detail, 'split');
  assert.equal(open('#shape=single&isl=4000&osl=500&cachedShare=0.5&ctx=32768').shape, 'simple');
  // Simple with a_* parameters (links made when every link carried them) stays Simple.
  assert.equal(open('#shape=simple&' + old).shape, 'simple');
  // The percentages come back from a link, are clamped, and never throw.
  assert.deepEqual(open('#shape=detailed&sc=20&so=30').split, { cachedPct: 20, outputPct: 30 });
  assert.deepEqual(open('#shape=detailed&sc=500&so=500').split, { cachedPct: 1, outputPct: 99 });
  assert.deepEqual(open('#shape=detailed&sc=-5&so=-5').split, { cachedPct: 0, outputPct: 0.1 });
  assert.deepEqual(open('#shape=detailed&sc=abc&so=').split, { cachedPct: 80, outputPct: 10 });
  assert.deepEqual(open('#sc=20').split, { cachedPct: 20, outputPct: 10 }, 'the percentages in a Simple link are kept for when the reader opens Detailed');
  assert.equal(open('#detail=banana&shape=detailed').detail, 'split');
  assert.deepEqual(open('#detail=loop%E0%A4%A&sc=%E0%A4%A&so=zz&shape=banana&foo=1').split, { cachedPct: 80, outputPct: 10 });
  assert.doesNotThrow(() => open('#shape=detailed&detail=%E0%A4%A&sc=zzz&so=&a_c0=&ctx=zzz'));
  assert.deepEqual(fromHash(''), {});
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
  // The custom split uses the field too; the agent loop does not.
  assert.equal(ask({ ctx: 1048576, shape: 'detailed' }), 'Context length capped at 262,144 tokens, the window of Qwen3.8 27B.');
  assert.equal(ask({ ctx: 500, shape: 'detailed' }), 'Context length raised to 2,000 tokens, the smallest the calculator allows.');
  assert.equal(ask({ ctx: 1048576, shape: 'detailed', detail: 'loop' }), null, 'the loop does not use the field');
  assert.equal(ask({ ctx: undefined }), null);
  assert.equal(ask({ ctx: NaN }), null);
});

test('split note: says so when a percentage was capped or raised, only for the custom split', () => {
  const ask = (split, opts, patch = {}) => { const merged = { ...DEFAULT_STATE, shape: 'detailed', ...patch, split }; return splitClampNote(merged, normalizeState(merged, data), opts); };
  assert.equal(ask({ cachedPct: 20, outputPct: 10 }), null, 'nothing changed');
  assert.equal(ask({ cachedPct: 33.33, outputPct: 10 }), null, 'rounding to one decimal is not worth a sentence');
  assert.equal(ask({ cachedPct: 80, outputPct: 10 }), null);
  assert.equal(ask({ cachedPct: 20, outputPct: 150 }), 'Output capped at 99% of the context. Cached input capped at 1% of the context, what the output leaves.');
  assert.equal(ask({ cachedPct: 95, outputPct: 10 }), 'Cached input capped at 90% of the context, what the output leaves.');
  assert.equal(ask({ cachedPct: 80, outputPct: 30 }), 'Cached input capped at 70% of the context, what the output leaves.');
  assert.equal(ask({ cachedPct: 20, outputPct: 0 }), 'Output raised to 0.1% of the context, the smallest the calculator allows.');
  assert.equal(ask({ cachedPct: -3, outputPct: 10 }), 'Cached input raised to 0% of the context.');
  assert.equal(ask({ cachedPct: 20, outputPct: 0 }, { quiet: true }), null, 'quiet: a number still being typed is not corrected aloud');
  assert.equal(ask({ cachedPct: 95, outputPct: 10 }, { quiet: true }), 'Cached input capped at 90% of the context, what the output leaves.', 'quiet only hides the "raised" sentences');
  assert.equal(ask({ cachedPct: 95, outputPct: 10 }, {}, { shape: 'simple' }), null, 'Simple has no percentages to change');
  assert.equal(ask({ cachedPct: 95, outputPct: 10 }, {}, { detail: 'loop' }), null, 'nor has the agent loop');
  assert.equal(splitClampNote({ ...DEFAULT_STATE, shape: 'detailed' }, norm({ shape: 'detailed' })), null, 'a link with no percentages');
  assert.equal(splitClampNote({ shape: 'detailed', split: { cachedPct: 'x' } }, norm({ shape: 'detailed' })), null);
  // Both sentences, joined: the context length first.
  const merged = { ...DEFAULT_STATE, shape: 'detailed', ctx: 500, split: { cachedPct: 95, outputPct: 10 } };
  assert.equal(workloadNote(merged, normalizeState(merged, data), data), 'Context length raised to 2,000 tokens, the smallest the calculator allows. Cached input capped at 90% of the context, what the output leaves.');
  assert.equal(workloadNote({ ...DEFAULT_STATE }, norm({}), data), null);
  assert.equal(fmtShare(33.3), '33.3%'); assert.equal(fmtShare(80), '80%'); assert.equal(fmtShare(0.1), '0.1%'); assert.equal(fmtShare(null), 'n/a');
});

test('API side: headline, cards and table read the same effective workload in every mode', () => {
  for (const patch of [{}, { ctx: 131072 }, { ctx: 32768 }, { shape: 'detailed' }, { shape: 'detailed', ctx: 100000, split: { cachedPct: 20, outputPct: 30 } }, { shape: 'detailed', detail: 'loop' }]) {
    const st = norm(patch);
    const res = evaluate(st, data);
    const view = buildView(res, st, data);
    const w = res.workload;
    const row = (label) => view.assumptions.find((a) => a.label === label);
    assert.ok(row('Input tokens per request').value.startsWith(Math.round(w.isl).toLocaleString('en-US')));
    assert.ok(row('Output tokens per request').value.startsWith(Math.round(w.osl).toLocaleString('en-US')));
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
