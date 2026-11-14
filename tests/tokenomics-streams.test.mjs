// Parallel streams as an average (fractions below 1), the stream formatter, the
// log slider, and the like-for-like default API. Real data files, no browser.
// Run: node --test tests/tokenomics-streams.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEFAULT_STATE, normalizeState, toHash, fromHash } from '../src/lib/tokenomics/ui/state.mjs';
import { roundC, posToC, cToPos, C_MIN, C_MAX } from '../src/lib/tokenomics/ui/streams.mjs';
import { fmtStreams, streamsPhrase } from '../src/lib/tokenomics/ui/format.mjs';
import { apiOptions } from '../src/lib/tokenomics/ui/options.mjs';
import { followModel, linkState } from '../src/lib/tokenomics/ui/api-follow.mjs';
import { evaluate } from '../src/lib/tokenomics/ui/evaluate.mjs';
import { buildView } from '../src/lib/tokenomics/ui/view.mjs';
import { monthlyChartSvg, perMtokChartSvg, chartLayout, chartModel } from '../src/lib/tokenomics/ui/chart.mjs';
import { markers } from '../src/lib/tokenomics/ui/chart-here.mjs';
import { xMaxFor } from '../src/lib/tokenomics/ui/chart-domain.mjs';
import { readoutLines } from '../src/lib/tokenomics/ui/chart-hover.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const rd = (f) => JSON.parse(readFileSync(join(here, '../public/data/tokenomics/' + f), 'utf8'));
const data = { models: rd('models.json'), gpus: rd('gpus.json'), apiPrices: rd('api_prices.json'), rentOffers: rd('rent_offers.json'), buyOptions: rd('buy_options.json'), meta: rd('meta.json') };
const norm = (s) => normalizeState({ ...DEFAULT_STATE, ...s }, data);
const at = (s) => { const st = norm(s); const res = evaluate(st, data); return { st, res, view: buildView(res, st, data) }; };

test('C: a float in [0.01, 10000], rounded to 3 significant digits', () => {
  const want = [[0.123456, 0.123], [0.001, 0.01], [0, 0.01], [-5, 0.01], [20000, 10000], [10000, 10000], [1234, 1230], [99.96, 100], [0.05, 0.05], [0.0123456, 0.0123], [1, 1], [2.5, 2.5], [100, 100], [9999, 10000], [0.01, 0.01]];
  for (const [input, out] of want) {
    assert.equal(roundC(input), out, 'roundC ' + input);
    assert.equal(norm({ C: input }).C, out, 'normalizeState C ' + input);
  }
  assert.equal(norm({ C: NaN }).C, 100, 'default when it is not a number');
  assert.equal(norm({ C: 'x' }).C, 100);
  assert.equal(DEFAULT_STATE.C, 100);
  assert.deepEqual([C_MIN, C_MAX], [0.01, 10000]);
  // Idempotent.
  for (const [, out] of want) assert.equal(roundC(out), out);
});

test('C: floats round-trip through the link, and integer links in the wild still work', () => {
  for (const C of [0.01, 0.05, 0.123, 0.3, 1, 2.5, 33.3, 100, 1230, 10000]) {
    const st = norm({ C });
    assert.equal(st.C, C);
    assert.ok(new RegExp('(^|&)C=' + String(C).replace('.', '\\.') + '(&|$)').test(toHash(st)), 'link says C=' + C);
    assert.deepStrictEqual(st, normalizeState(fromHash(toHash(st)), data), 'round trip at ' + C);
    assert.deepStrictEqual(st, normalizeState(fromHash('#' + toHash(st)), data));
  }
  assert.equal(normalizeState({ ...DEFAULT_STATE, ...fromHash('#C=100&shape=simple') }, data).C, 100);
  assert.equal(normalizeState({ ...DEFAULT_STATE, ...fromHash('#C=0.123456') }, data).C, 0.123);
  assert.equal(normalizeState({ ...DEFAULT_STATE, ...fromHash('#C=20000') }, data).C, 10000);
  assert.equal(normalizeState({ ...DEFAULT_STATE, ...fromHash('#C=0.001') }, data).C, 0.01);
  assert.equal(normalizeState({ ...DEFAULT_STATE, ...fromHash('#C=') }, data).C, 100, 'empty is ignored');
});

test('slider: 1,000 steps on a log scale over 0.01 to 10,000, and the round numbers come back exactly', () => {
  assert.equal(posToC(0), 0.01); assert.equal(posToC(1000), 10000);
  assert.equal(cToPos(0.01), 0); assert.equal(cToPos(10000), 1000);
  for (const c of [0.01, 0.1, 1, 100, 10000]) assert.equal(posToC(cToPos(c)), c, 'round trip at ' + c);
  assert.deepEqual([0.01, 0.1, 1, 10, 100, 1000, 10000].map(cToPos), [0, 167, 333, 500, 667, 833, 1000]);
  let prev = 0;
  for (let p = 0; p <= 1000; p++) {
    const c = posToC(p);
    assert.ok(c >= prev && c >= 0.01 && c <= 10000, 'monotone and in range at ' + p);
    assert.equal(roundC(c), c, 'a value the state keeps as it is, at ' + p);
    assert.ok(Math.abs(cToPos(c) - p) <= 4, 'position ' + p + ' maps to ' + c + ' and back to ' + cToPos(c));
    prev = c;
  }
  // Out of range and junk are clamped, never NaN.
  assert.equal(posToC(-50), 0.01); assert.equal(posToC(5000), 10000); assert.equal(posToC('x'), 0.01);
  assert.equal(cToPos(0), 0); assert.equal(cToPos(1e9), 1000); assert.equal(cToPos(NaN), 0);
});

test('formatter: whole numbers as ever, up to two digits below 1, one decimal only when needed', () => {
  const want = [[10000, '10,000'], [1000, '1,000'], [100, '100'], [150, '150'], [12.3, '12.3'], [10, '10'], [3, '3'], [2.5, '2.5'], [1.2, '1.2'], [1, '1'], [0.5, '0.5'], [0.3, '0.3'], [0.1, '0.1'], [0.05, '0.05'], [0.0123, '0.012'], [0.01, '0.01'], [0.999, '0.99'], [0.996, '0.99']];
  for (const [n, text] of want) assert.equal(fmtStreams(n), text, 'fmtStreams ' + n);
  assert.equal(fmtStreams(NaN), 'n/a'); assert.equal(fmtStreams(null), 'n/a');
  assert.equal(streamsPhrase(1), '1 parallel stream');
  for (const [n, text] of [[0.1, '0.1 parallel streams'], [0.05, '0.05 parallel streams'], [2.5, '2.5 parallel streams'], [100, '100 parallel streams'], [1000, '1,000 parallel streams'], [0.999, '0.99 parallel streams']]) assert.equal(streamsPhrase(n), text);
});

test('like-for-like: the default API is the same model on its maker API, listed first', () => {
  assert.equal(DEFAULT_STATE.apiId, 'ref:qwen3.8-27b');
  const st = norm({});
  assert.equal(st.apiId, 'ref:qwen3.8-27b');
  const price = data.apiPrices.find((p) => p.id === st.apiId);
  assert.equal(price.group, 'open_weight_reference'); assert.equal(price.linkedModelId, 'qwen3.8-27b');
  const groups = apiOptions(data);
  assert.deepEqual(groups.map((g) => g.label), ['Same model on an API (like for like)', 'Claude', 'OpenAI', 'Gemini']);
  // One entry per model, in the models' order, each linked to its model; the frontier groups follow.
  assert.deepEqual(groups[0].items.map((i) => i.id), data.models.map((m) => 'ref:' + m.id));
  assert.equal(groups[0].items[0].label, 'Qwen3.8 27B (Maker API)');
  assert.ok(groups[0].items.every((i) => /^.+ \(.+\)$/.test(i.label)));
  assert.ok(groups.slice(1).every((g) => g.items.every((i) => !i.id.startsWith('ref:'))));
  // The default evaluates cleanly and the like-for-like API is cheaper than the frontier one for the same tokens.
  const a = at({}); const b = at({ apiId: 'Anthropic:claude-sonnet-5-5' });
  assert.deepEqual(a.res.errors, []);
  assert.equal(a.view.api.title, 'Qwen3.8 27B API');
  assert.ok(a.res.api.monthly.usdPerMonth < b.res.api.monthly.usdPerMonth);
});

test('like-for-like: the API follows a change of model, a frontier API is left alone', () => {
  const prev = norm({});
  const to = (modelId, extra = {}) => ({ ...prev, modelId, ...extra });
  for (const m of data.models) assert.equal(followModel(prev, to(m.id), data).apiId, 'ref:' + m.id, 'follows to ' + m.id);
  assert.equal(followModel(prev, prev, data), prev, 'same model: nothing to do');
  // A frontier API the reader picked stays.
  const frontier = norm({ apiId: 'Anthropic:claude-sonnet-5-5' });
  assert.equal(followModel(frontier, { ...frontier, modelId: 'kimi-k3.1-pro' }, data).apiId, 'Anthropic:claude-sonnet-5-5');
  // Changing the API in the same event wins over following the model.
  assert.equal(followModel(prev, to('kimi-k3.1-pro', { apiId: 'OpenAI:gpt-6-luna' }), data).apiId, 'OpenAI:gpt-6-luna');
  // No like-for-like price for the new model: the API stays.
  const without = { ...data, apiPrices: data.apiPrices.filter((p) => p.id !== 'ref:kimi-k3.1-pro') };
  assert.equal(followModel(prev, to('kimi-k3.1-pro'), without).apiId, 'ref:qwen3.8-27b');
  // The result is a normal state: it evaluates, and the card names the new model.
  const moved = normalizeState(followModel(prev, to('kimi-k3.1-pro'), data), data);
  assert.equal(moved.apiId, 'ref:kimi-k3.1-pro');
  assert.equal(buildView(evaluate(moved, data), moved, data).api.title, 'Kimi K3.1 Pro API');
  // A link names its API outright: followModel is not applied to links, so the link is honoured.
  assert.equal(norm({ modelId: 'kimi-k3.1-pro', apiId: 'ref:qwen3.8-27b' }).apiId, 'ref:qwen3.8-27b');
  // A link that names a model and no API gets that model's like-for-like API; a link that names an API keeps it.
  const asLink = (hash) => normalizeState(linkState(fromHash(hash), DEFAULT_STATE, data), data);
  assert.equal(asLink('#modelId=gemma-4-31b').apiId, 'ref:gemma-4-31b');
  assert.equal(asLink('#modelId=gemma-4-31b&apiId=ref%3Aqwen3.8-27b').apiId, 'ref:qwen3.8-27b');
  assert.equal(asLink('#modelId=gemma-4-31b&apiId=Anthropic%3Aclaude-sonnet-5-5').apiId, 'Anthropic:claude-sonnet-5-5');
  assert.equal(asLink('').apiId, 'ref:qwen3.8-27b');
  assert.equal(asLink('#C=0.05').apiId, 'ref:qwen3.8-27b');
});

test('range: xMaxFor for fractions of a stream', () => {
  for (const C of [0.01, 0.05, 0.3, 0.999, 1, 33]) assert.equal(xMaxFor(C), 100, 'C = ' + C);
  assert.equal(xMaxFor(34), 1000);
});

// A frontier API whose price makes self-hosting win below one stream at the default workload (GPT-5.5 Pro: $30 in, $180 out).
const PRO = 'OpenAI:gpt-5.5-pro';

test('fractions: a dear API crosses below one stream, and the cards read well at C = 0.05', () => {
  // Simple default (235,930 input tokens, 26,214 output tokens): on GPT-5.5 Pro the API bill is large, so self-hosting wins from a fraction of a stream.
  const d = at({ apiId: PRO });
  assert.equal(d.res.crossover.mid, 0.0693);
  assert.equal(d.view.crossoverText, "Self-hosting becomes cheaper from about 0.069 parallel streams. Below that, the GPU would sit partly idle, so the API's pay-per-use is cheaper.");
  // The first grid value where the API costs more: one step lower it does not.
  const above = at({ apiId: PRO, C: 0.0693 }).res; const below = at({ apiId: PRO, C: 0.0692 }).res;
  assert.ok(above.api.monthly.usdPerMonth > above.self.usdPerMonth, 'API dearer at 0.0693');
  assert.ok(below.api.monthly.usdPerMonth <= below.self.usdPerMonth, 'API cheaper (or equal) at 0.0692');
  // One machine whatever the usage; the API bill is proportional to it.
  const p = at({ C: 0.05 });
  assert.equal(p.res.self.replicas, 1); assert.equal(p.res.self.machines, 1);
  assert.equal(p.res.self.usdPerMonth, at({ C: 0.01 }).res.self.usdPerMonth, 'a GPU costs the same however little it is used');
  assert.ok(Math.abs(p.res.api.monthly.usdPerMonth / at({ C: 0.01 }).res.api.monthly.usdPerMonth - 5) < 1e-9, 'the API bill shrinks with usage');
  assert.ok(p.view.headline.startsWith('At 0.05 parallel streams the API costs $'), p.view.headline);
  assert.match(p.view.headline, /times dearer\)\.$/);
  assert.match(p.view.self.deployment, /^1 replica of 1 GPU each, on 1 machine/);
  // A crossover between 1 and 10 streams: Simple at 32,768 tokens crosses at 8 (it was 2 before the 80/10/10 split).
  const mid = at({ ctx: 32768 });
  assert.equal(mid.res.crossover.mid, 8);
  assert.match(mid.view.crossoverText, /^At the expected speed, self-hosting becomes cheaper from about 8 parallel streams\./);
  // A short context crosses at 8 too.
  const short = at({ ctx: 2000 });
  assert.equal(short.res.crossover.mid, 8);
  for (const C of [0.01, 0.05, 0.5, 1, 7, 8, 9, 10]) { // above 1 the crossover is searched on whole numbers
    const r = at({ ctx: 2000, C }).res;
    assert.equal(r.api.monthly.usdPerMonth > r.self.usdPerMonth, C >= 8, 'C = ' + C + ' on the right side of the crossover');
  }
});

test('fractions: the marker, the crosshair readout and the two charts at C = 0.01, 0.05, 0.3 and 1', () => {
  for (const C of [0.01, 0.05, 0.3, 1]) {
    const res = at({ C, ctx: 2000 }).res;
    assert.equal(res.sweep.xMax, 100);
    for (const name of ['desktop', 'phone']) {
      const L = chartLayout(res, name);
      for (const perMtok of [false, true]) {
        const { scale } = chartModel(res, perMtok, L);
        const m = markers(res, perMtok, scale, L).here;
        assert.ok(m.x >= L.ML && m.x <= L.ML + L.PW, 'marker x in the plot (C ' + C + ')');
        for (const y of [m.yApi, m.ySelf]) assert.ok(y > L.MT && y < L.MT + L.PH, 'dots in the plot (C ' + C + ', ' + name + ')');
        assert.ok(m.label.text.endsWith(fmtStreams(C)), 'label says ' + fmtStreams(C) + ': ' + m.label.text);
      }
    }
    const svg = monthlyChartSvg(res, {});
    assert.ok(svg.includes('>C = ' + fmtStreams(C) + '<') || svg.includes('>' + fmtStreams(C) + '<'), 'the marker label is in the svg');
    assert.ok(svg.includes('Your setting: C = ' + fmtStreams(C) + ', the API costs'));
    assert.deepEqual([...svg.matchAll(/<text class="chart-tick" x="[\d.]+" y="[\d.]+" text-anchor="middle">([^<]*)</g)].map((x) => x[1]), ['0.01', '0.1', '1', '10', '100']);
    assert.ok(perMtokChartSvg(res, {}).includes('chart-here'));
    // A readout at a fractional sample says it in words.
    const i = res.sweep.cs.indexOf(0.1);
    assert.ok(i > 0);
    assert.equal(readoutLines(res, false, i)[0], 'At 0.1 parallel streams');
    assert.ok(readoutLines(res, false, i).some((l) => l.startsWith('Needs 1 machine (1 replica)')));
  }
  // A fractional crossover: drawn at its place, labelled with the formatter, and the two labels stay apart.
  const d = at({ C: 0.3, apiId: PRO }).res;
  assert.equal(d.crossover.mid, 0.0693);
  const L = chartLayout(d, 'desktop');
  const both = markers(d, false, chartModel(d, false, L).scale, L);
  assert.equal(both.cross.text, 'C = 0.069');
  assert.ok(both.cross.x < both.here.x && both.cross.x > L.ML);
  const svg = monthlyChartSvg(d, {});
  assert.ok(svg.includes('class="chart-cross"') && svg.includes('>C = 0.069<'));
});
