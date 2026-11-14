// Overlay texts of the calculator: the registry in ui/tips.mjs, the run-time
// facts in ui/tip-facts.mjs and the placement in ui/tip-place.mjs. No browser
// needed. Run: node --test tests/tokenomics-tips.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { TIPS, tipText, basisKey } from '../src/lib/tokenomics/ui/tips.mjs';
import { buildFacts } from '../src/lib/tokenomics/ui/tip-facts.mjs';
import { placeTip, placeRight } from '../src/lib/tokenomics/ui/tip-place.mjs';
import { DEFAULT_STATE, normalizeState } from '../src/lib/tokenomics/ui/state.mjs';
import { evaluate } from '../src/lib/tokenomics/ui/evaluate.mjs';
import { buildView } from '../src/lib/tokenomics/ui/view.mjs';
import { rentTerms } from '../src/lib/tokenomics/ui/options.mjs';
import { fmtUsdSmall } from '../src/lib/tokenomics/ui/format.mjs';
import * as calc from '../src/lib/tokenomics/calc.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const ui = join(here, '../src/lib/tokenomics/ui/');
const src = (rel) => readFileSync(rel.startsWith('/') ? rel : join(ui, rel), 'utf8');
const JR = (f) => JSON.parse(readFileSync(join(here, '../public/data/tokenomics/' + f), 'utf8'));
const real = { models: JR('models.json'), gpus: JR('gpus.json'), apiPrices: JR('api_prices.json'), rentOffers: JR('rent_offers.json'), buyOptions: JR('buy_options.json'), meta: JR('meta.json') };

const BANNED_CHARS = /[\u2013\u2014\u2018\u2019\u201C\u201D]/;
const BANNED_WORDS = /\b(survey(ed|s)?|checked|verified)\b/i;
// Sentences of a static text; a {slot} is filled at run time and is not counted.
const sentences = (t) => t.replace(/\{\w+\}/g, '').split(/[.!?](?:\s|$)/).filter((x) => x.trim().length > 0).length;

// A spread of page states: the defaults, buy, agent, an unoffered combination
// and every model at every bit width (some are estimated checkpoints).
function states() {
  const list = [
    { ...DEFAULT_STATE },
    { ...DEFAULT_STATE, mode: 'buy', buyGpu: 'rtx6000pro' },
    { ...DEFAULT_STATE, mode: 'buy', buyGpu: 'b200', shape: 'detailed', detail: 'loop', modelId: 'deepseek-v4.1-flash' },
    { ...DEFAULT_STATE, shape: 'detailed', split: { cachedPct: 20, outputPct: 30 } },
    { ...DEFAULT_STATE, modelId: 'kimi-k3.1-pro' },
    { ...DEFAULT_STATE, v: 500 },
    { ...DEFAULT_STATE, apiId: 'ref:muse-spark-open' },
    { ...DEFAULT_STATE, C: 0.05, ctx: 2000 },
    { ...DEFAULT_STATE, C: 0.01 },
    { ...DEFAULT_STATE, C: 2.5, ctx: 32768, apiId: 'Anthropic:claude-sonnet-5-5' },
  ];
  for (const m of real.models) for (const bits of [4, 8, 16]) list.push({ ...DEFAULT_STATE, modelId: m.id, bits });
  return list.map((s) => normalizeState(s, real));
}

test('registry: every text is plain ASCII, non-empty, short, with no banned dashes, quotes or claims', () => {
  const keys = Object.keys(TIPS);
  assert.ok(keys.length >= 90, 'expected the full set of overlays, found ' + keys.length);
  for (const key of keys) {
    const t = TIPS[key];
    assert.ok(typeof t === 'string' && t.trim().length > 10, key + ' has text');
    assert.ok(!BANNED_CHARS.test(t), key + ' has an em dash, en dash or curly quote');
    assert.ok(/^[\x20-\x7e]+$/.test(t), key + ' is not plain ASCII');
    assert.ok(!BANNED_WORDS.test(t), key + ' claims a survey or a check');
    assert.ok(!/ - /.test(t) && !/--/.test(t), key + ' uses a dash as punctuation');
    assert.ok(sentences(t) <= 3, key + ' has ' + sentences(t) + ' sentences');
  }
});

test('registry: every {name} slot is filled for every state, and the filled text is clean', () => {
  const slots = new Set(Object.values(TIPS).flatMap((t) => [...t.matchAll(/\{(\w+)\}/g)].map((m) => m[1])));
  assert.ok(slots.size >= 20, 'slots in use: ' + [...slots].join());
  for (const s of states()) {
    const result = evaluate(s, real);
    const facts = buildFacts(s, real, result);
    for (const name of slots) assert.ok(facts[name] !== undefined, 'fact ' + name + ' for ' + s.modelId + '/' + s.bits);
    for (const key of Object.keys(TIPS)) {
      const t = tipText(key, facts);
      assert.ok(t.length > 10 && !/[{}]/.test(t), key + ' has an unfilled slot: ' + t);
      assert.ok(/^[\x20-\x7e]+$/.test(t) && !BANNED_CHARS.test(t) && !BANNED_WORDS.test(t), key + ' filled text is not clean: ' + t);
      for (const bad of ['undefined', 'NaN', 'null', 'Infinity', '[object']) assert.ok(!t.includes(bad), key + ' contains ' + bad + ': ' + t);
    }
  }
});

test('registry: facts come from the data and the result', () => {
  const s = normalizeState({ ...DEFAULT_STATE }, real);
  const r = evaluate(s, real);
  const f = buildFacts(s, real, r);
  assert.equal(f.captured, real.meta.oldestCapture);
  assert.equal(f.C, '100');
  assert.equal(f.bv, r.self.Bv);
  assert.equal(f.bandLow, String(real.gpus.find((g) => g.id === 'rtx6000pro').band.low));
  assert.equal(f.bandHigh, '2');
  assert.equal(f.amortYears, String(real.buyOptions.defaults.amortYears));
  assert.ok(f.deployNow.startsWith(r.self.replicas + ' replicas of 1 GPU each, on ' + r.self.machines + ' machines'));
  assert.ok(f.machineNow.startsWith('g7e.2xlarge: 1 x RTX PRO 6000'));
  assert.ok(f.apiNow.includes('Qwen3.8 27B (Maker API)') && f.apiNow.includes('per million output tokens'), 'the default API is the same model on its maker API: ' + f.apiNow);
  assert.equal(f.maxSpeedNote, 'On this setup one request alone reaches about 34 tokens per second, so asking for more than that cannot be met by one GPU.');
  assert.equal(f.simpleSplit, '80% cached input, 10% new input and 10% output');
  assert.equal(f.newTokens, '26,214', 'the new input of the default request: 10% of 262,144 tokens');
  assert.equal(f.isl, '235,930'); assert.equal(f.osl, '26,214'); assert.equal(f.cachedPct, '89%');
  assert.equal(f.C, '100'); assert.equal(buildFacts({ ...s, C: 0.05 }, real, evaluate({ ...s, C: 0.05 }, real)).C, '0.05');
  // Simple default: the whole 262,144-token window is reserved for every request, so one request fills a replica.
  assert.ok(f.ctxNow.startsWith('At 262,144 tokens, one replica holds 1 request at once'), f.ctxNow);
  const cached = normalizeState({ ...DEFAULT_STATE, apiId: real.apiPrices.find((p) => p.cachedInput == null)?.id ?? DEFAULT_STATE.apiId }, real);
  if (real.apiPrices.some((p) => p.cachedInput == null)) assert.ok(buildFacts(cached, real, evaluate(cached, real)).apiCachedNow.includes('no cached price'));
});

test('registry: the context length overlay says what Simple mode fixes and why memory is the worst case', () => {
  const t = TIPS.ctx;
  for (const part of ['every request holds in total', 'reserved up front', 'deliberately the worst case', 'real agents that stay shorter need fewer machines', 'In Simple mode every request is split {simpleSplit}', 'Detailed lets you change that']) assert.ok(t.includes(part), part);
  assert.ok(TIPS['as.ctx'].includes('worst case') && TIPS['as.ctx'].includes('Detailed'));
  assert.equal(basisKey('reserved in full for every request (worst case)'), 'basis.worstcase');
  assert.equal(basisKey('fixed in simple mode'), 'basis.simple');
  assert.equal(basisKey('largest context the loop reaches, capped at the model window'), 'basis.loopmax');
  for (const key of ['shape.simple', 'shape.detailed', 'fs.workload', 'detail', 'detail.split', 'detail.loop', 'split.cached', 'split.output', 'split.new']) assert.ok(TIPS[key].length > 30, key);
  // The texts that describe Simple say the 80/10/10 split, from the same words the form shows (never 1,000 or "nothing is cached").
  const s = normalizeState({ ...DEFAULT_STATE }, real);
  const f = buildFacts(s, real, evaluate(s, real));
  for (const key of ['shape.simple', 'ctx']) {
    assert.ok(tipText(key, f).includes('80% cached input, 10% new input and 10% output'), key + ' says the split');
    assert.ok(!/1,000|nothing is cached/.test(tipText(key, f)), key + ' no longer says the old fixed assumption');
  }
  for (const key of ['as.isl', 'as.osl', 'as.cached']) assert.ok(!/1,000|nothing is cached/.test(TIPS[key]), key + ' no longer says the old fixed assumption');
  // The Detailed fields: what each share means, in plain words.
  assert.ok(TIPS['detail'].includes('custom split') && TIPS['detail'].includes('agent loop'));
  assert.ok(TIPS['detail.split'].includes('cached input') && TIPS['detail.split'].includes('The rest is new input, billed at the full input price') && TIPS['detail.split'].includes('whole context length'));
  assert.ok(TIPS['detail.loop'].includes('many turns') && TIPS['detail.loop'].includes('{isl} input tokens'));
  assert.ok(TIPS['split.cached'].includes('billed at the cached price') && TIPS['split.cached'].includes('add up to the whole context') && TIPS['split.cached'].includes('{apiCachedNow}'));
  assert.ok(TIPS['split.output'].includes('0.1% to 99%') && TIPS['split.output'].includes('output price'));
  assert.ok(TIPS['split.new'].includes('full input price') && TIPS['split.new'].includes('it follows the other two') && TIPS['split.new'].includes('{newTokens}'));
  assert.equal(tipText('split.new', f), TIPS['split.new'].replace('{newTokens}', '26,214'));
  for (const gone of ['shape.single', 'shape.agent', 'isl', 'osl', 'cached']) assert.ok(!(gone in TIPS), gone + ' belonged to the old single-request fields');
});

test('registry: the requests per replica overlay carries the 7 versus 6.38 example about memory, and memory says 7', () => {
  const t = TIPS['self.perReplica'];
  for (const part of ['memory model is simpler than the serving engine', 'about one request per GPU', 'Qwen3.8 27B', 'RTX PRO 6000', '4 bits', '262,144-token window', 'says 7', 'vLLM startup log in part 4', '6.38']) assert.ok(t.includes(part), part);
  // The example is the memory model: how many requests fit in GPU memory with the whole window reserved for each.
  const model = real.models.find((m) => m.id === 'qwen3.8-27b');
  const gpu = real.gpus.find((g) => g.id === 'rtx6000pro');
  assert.equal(calc.minGpus(model, 4, gpu, 262144), 1, 'one RTX PRO 6000');
  const step = calc.stepModel(model, 4, gpu, 1, 4000, 500, 1, { ctx: 262144 });
  assert.equal(Math.floor(step.bMax), 7, 'the memory model says 7 requests fit');
  // The page's own figure is the smaller of memory and speed: in Simple mode (a 261k-token prompt, no cache) speed is the limit.
  const s = normalizeState({ ...DEFAULT_STATE }, real);
  const r = evaluate(s, real);
  assert.equal(r.self.g, 1);
  assert.equal(r.self.Bv, 1);
  assert.ok(r.self.Bv <= Math.floor(step.bMax));
  // The same model with the cached agent loop is limited by memory alone, and the figure is the memory one.
  const wide = calc.sizeDeployment({ model, bits: 4, gpu, C: 1, isl: 4000, osl: 500, v: 30, cachedShare: 0.5, ctx: 262144, mtp: false, tf: 1 });
  assert.equal(wide.Bv, 7);
});

test('markup: every overlay key used by the page exists, and every text is used', () => {
  const used = new Set();
  const take = (text, re, group = 1) => { for (const m of text.matchAll(re)) used.add(m[group]); };
  take(src(join(here, '../src/components/tokenomics/Calculator.astro')), /data-tip="([^"]+)"/g);
  take(src('chart.mjs'), /data-ctip="(chart\.[\w.]+)"/g);
  take(src('chart.mjs'), /'(chart\.[\w.]+)'/g);
  take(src('dom/chart-hover.mjs'), /'(chart\.[\w.]+)'/g);
  take(src('view.mjs'), /key: '(as\.\w+)'/g);
  const controls = src('dom/controls.mjs');
  take(controls, /group\('[^']*',\s*'([^']+)'\)/g);
  take(controls, /field\(\s*\w+,\s*'[^']*',\s*'[^']*',\s*\w+,\s*'([^']+)'/g);
  take(controls, /\[(?:'\w+'|\d+),\s*(?:'[^']*'|opts\['\d+'\]\.label),\s*'([^']+)'\]/g);
  take(controls, /'Bits per weight'\),\s*'([^']+)'/g);
  take(controls, /'Shape of each request'\),\s*'([^']+)'/g);
  take(controls, /tip\(el\('div', \{[^}]*\}\), '([^']+)'\)/g);
  // Keys built at run time: the terms the data has, and the basis cells of every assumptions row.
  for (const t of new Set(real.rentOffers.map((o) => o.term))) used.add('term.' + t);
  for (const s of states().slice(0, 3)) {
    for (const a of buildView(evaluate(s, real), s, real).assumptions) used.add(basisKey(a.basis));
  }
  take(src('tips.mjs').split('const BASIS_KEYS')[1], /'(basis\.\w+)'/g);
  used.add('basis.notmodelled'); used.add('basis.assumption');
  for (const t of rentTerms(real, 'AWS', 'g7e.2xlarge')) assert.ok(TIPS['term.' + t], 'term text for ' + t);

  const missing = [...used].filter((k) => !(k in TIPS));
  assert.deepEqual(missing, [], 'keys in the markup with no text');
  const unused = Object.keys(TIPS).filter((k) => !used.has(k));
  assert.deepEqual(unused, [], 'texts nothing points at');
  assert.ok(used.size >= 90);
});

test('markup: the form has a tip on every label and control, and the legend entries have one each', () => {
  const controls = src('dom/controls.mjs');
  // field() puts the key on both the label and the control; group() on the legend; radioRow() on label and input.
  assert.ok(controls.includes("wrap.append(tip(el('label', { for: id }, labelText), key), tip(control, key));"));
  assert.ok(/fs\.appendChild\(tip\(el\('legend'/.test(controls));
  assert.ok(/const label = tip\(el\('label', \{ for: input\.id, class: 'tk-opt' \}\), key\)/.test(controls));
  const astro = src(join(here, '../src/components/tokenomics/Calculator.astro'));
  assert.equal((astro.match(/<li tabindex="0" data-tip="legend\.\w+"/g) ?? []).length, 5);
  assert.ok(astro.includes('data-tip="legend.here"') && astro.includes('Your setting (solid line)'));
  for (const key of ['legend.here', 'chart.here']) assert.ok(TIPS[key].includes('the number of parallel streams you chose') && TIPS[key].includes('the same figures as the cards above'), key);
  assert.ok(TIPS['chart.axis.x'].includes('follows your parallel streams setting'));
  assert.ok(!/<h2/.test(astro), 'the component has no title of its own');
  assert.ok(/aria-live="polite"/.test(astro));
});

test('basis: every basis cell the view writes maps to a real overlay', () => {
  for (const s of states().slice(0, 3)) {
    const rows = buildView(evaluate(s, real), s, real).assumptions;
    for (const a of rows) {
      const k = basisKey(a.basis);
      assert.ok(TIPS[k], a.basis + ' -> ' + k);
      assert.notEqual(k, 'basis.assumption', 'basis not mapped: ' + a.basis);
    }
  }
  assert.equal(basisKey('something new'), 'basis.assumption');
});

const VIEWPORT = { width: 1440, height: 900 };
const inside = (pos, tip, margin = 8) => pos.left >= margin && pos.top >= margin && pos.left + tip.width <= VIEWPORT.width - margin && pos.top + tip.height <= VIEWPORT.height - margin;

test('placement: below the anchor when it fits, above when it does not, always inside the viewport', () => {
  const tip = { width: 340, height: 120 };
  const rect = (left, top, w = 100, h = 30) => ({ left, top, right: left + w, bottom: top + h });
  const mid = placeTip({ anchor: rect(200, 200), tip, viewport: VIEWPORT });
  assert.equal(mid.side, 'below');
  assert.equal(mid.left, 200);
  assert.equal(mid.top, 230 + 10);
  const bottom = placeTip({ anchor: rect(200, 860), tip, viewport: VIEWPORT });
  assert.equal(bottom.side, 'above');
  assert.equal(bottom.top, 860 - 10 - 120);
  // Every corner and edge of the viewport, with a point and with a box.
  for (const x of [0, 5, 720, 1400, 1440]) {
    for (const y of [0, 5, 450, 880, 900]) {
      for (const anchor of [{ left: x, right: x, top: y, bottom: y }, rect(x, y, 60, 20)]) {
        const pos = placeTip({ anchor, tip, viewport: VIEWPORT });
        assert.ok(inside(pos, tip), 'anchor ' + x + ',' + y + ' -> ' + JSON.stringify(pos));
      }
    }
  }
  // A tall overlay on a short viewport is pinned to the margin instead of running off.
  const tall = placeTip({ anchor: rect(10, 10), tip: { width: 300, height: 890 }, viewport: VIEWPORT });
  assert.equal(tall.top, 8);
  // A narrow phone viewport.
  const phone = { width: 390, height: 844 };
  const narrow = placeTip({ anchor: rect(300, 400, 60, 20), tip: { width: 374, height: 100 }, viewport: phone });
  assert.equal(narrow.left, 8);
});

test("tips: the commitment discounts quoted in the term overlays match the data", async () => {
  const { readFileSync } = await import("node:fs");
  const offers = JSON.parse(readFileSync(new URL("../public/data/tokenomics/rent_offers.json", import.meta.url), "utf8"));
  const price = (term) => offers.find((o) => o.id === "AWS:p5.48xlarge:" + term).pricePerHour;
  for (const [term, key] of [["1y", "term.1y"], ["3y", "term.3y"]]) {
    const ratio = price(term) / price("on_demand");
    const text = TIPS[key];
    assert.ok(text.includes(ratio.toFixed(2) + " of the on-demand price"), key + " ratio " + ratio.toFixed(2));
    assert.ok(text.includes(Math.round((1 - ratio) * 100) + "% off"), key + " percent off");
  }
});

const overlap = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
const boxOf = (pos, tip) => ({ left: pos.left, top: pos.top, right: pos.left + tip.width, bottom: pos.top + tip.height });

test('placement: a control of the form gets the overlay to the right of the whole form, level with it', () => {
  const form = { left: 24, top: 100, right: 384, bottom: 1100 };
  const tip = { width: 340, height: 120 };
  const control = (top) => ({ left: 270, top, right: 380, bottom: top + 30 });
  for (const top of [120, 300, 650, 800, 870]) {
    const pos = placeRight({ anchor: control(top), container: form, tip, viewport: VIEWPORT });
    assert.equal(pos.side, 'right');
    assert.equal(pos.left, form.right + 12, 'starts just right of the form');
    assert.ok(pos.left >= form.right, 'never over the form');
    assert.ok(inside(pos, tip), 'inside the viewport at ' + top);
    assert.ok(!overlap(boxOf(pos, tip), form), 'never over any field of the form, so the next input stays visible');
    assert.ok(!overlap(boxOf(pos, tip), control(top)), 'never over the focused control');
    if (top + tip.height + 8 <= VIEWPORT.height) assert.equal(pos.top, top, 'level with the control');
  }
  // Near the bottom of the viewport it moves up instead of running off.
  const low = placeRight({ anchor: control(880), container: form, tip, viewport: VIEWPORT });
  assert.equal(low.top, VIEWPORT.height - tip.height - 8);
  // No room on the right: null, and the caller falls back to placeTip.
  assert.equal(placeRight({ anchor: control(300), container: { ...form, right: 1200 }, tip, viewport: VIEWPORT }), null);
  assert.equal(placeRight({ anchor: control(300), container: form, tip: { width: 1100, height: 100 }, viewport: VIEWPORT }), null);
});

test('placement: in one column the overlay goes above or below the focused control and never covers it', () => {
  const phone = { width: 390, height: 844 };
  for (const viewport of [phone, VIEWPORT]) {
    for (const height of [30, 60]) {
      for (let top = 0; top + height <= viewport.height; top += 7) {
        for (const tip of [{ width: 300, height: 90 }, { width: 374, height: 230 }]) {
          const anchor = { left: 20, top, right: 360, bottom: top + height };
          const pos = placeTip({ anchor, tip, viewport });
          assert.ok(inside({ left: pos.left, top: pos.top }, tip) || pos.left >= 8, 'inside the viewport');
          assert.ok(!overlap(boxOf(pos, tip), anchor), 'covers the control at top ' + top + ', tip ' + tip.height + ', viewport ' + viewport.height);
        }
      }
    }
  }
});

test('registry: the overlays say what the new controls and warnings mean, in plain words', () => {
  const has = (key, parts) => { for (const part of parts) assert.ok(TIPS[key].includes(part), key + ' says "' + part + '"'); };
  has('api', ['like-for-like option prices the same model on an API', 'Claude, OpenAI and Gemini options are different, larger models', 'tokens and not quality']);
  has('card.api', ['like-for-like option is the same model as yours', 'different, larger models', 'tokens and not quality']);
  has('C', ['average number of requests', '0.1 means a request is being answered a tenth of the time', '6 minutes of every hour', 'Below 1 the API bill shrinks with usage', 'a GPU costs the same however little it is used', 'self-hosting only pays for a steady load']);
  has('C.slider', ['0.01 to 10,000', 'logarithmic']);
  has('chart.axis.x', ['from 0.01', 'right edge follows your parallel streams setting', 'at least three times your number', '{xMax}']);
  has('chart.self', ['A dashed line means the speed you asked for is missed even with one request per GPU']);
  has('legend.self', ['dashed when the speed you asked for is missed']);
  has('v', ['{maxSpeedNote}']);
  has('warning', ['even one request alone cannot reach the speed per stream you asked for']);
  has('self.speedwarn', ['missed even when a replica serves one request alone', 'Lower the speed per stream or pick a faster GPU']);
  // The speed overlay quotes the speed of one lone request, from the result.
  const s = normalizeState({ ...DEFAULT_STATE }, real);
  const f = buildFacts(s, real, evaluate(s, real));
  assert.match(tipText('v', f), /On this setup one request alone reaches about 34 tokens per second, so asking for more than that cannot be met by one GPU\.$/);
  const none = normalizeState({ ...DEFAULT_STATE, modelId: 'kimi-k3.1-pro', rentProvider: 'AWS', rentOfferId: 'AWS:g7e.2xlarge:on_demand' }, real);
  assert.ok(!/reaches about/.test(tipText('v', buildFacts(none, real, evaluate(none, real)))), 'nothing about a speed when self-hosting is not offered');
  // The chart overlay quotes the right edge of the current chart.
  assert.match(tipText('chart.axis.x', f), /Right now it is 1,000\.$/);
});

test('electricity overlays: what the price is, how it enters the bill, where the default comes from, and that idle draw is not modelled', () => {
  const has = (key, parts) => { for (const part of parts) assert.ok(TIPS[key].includes(part), key + ' says "' + part + '"'); };
  has('energy', ['price per kWh', 'the rated power of one server', 'power usage effectiveness', '{pue}', '{hoursPerMonth} hours', 'this price', 'US commercial average', '{energyDefault}',
    'full rated power for every hour of the month', 'whether or not', 'an idle server draws less than its rating', 'on the high side', 'rack space is billed separately', 'assumptions table']);
  // The overlay may name the source only while the data still says so.
  const basis = real.buyOptions.defaults.basis.electricityUsdPerKwh;
  assert.match(basis.note, /US commercial average/);
  assert.match(basis.note, /\bEIA\b/, 'the overlay names the Energy Information Administration, which is the data source');
  assert.match(basis.sourceUrl, /eia\.gov/);
  assert.ok(TIPS.energy.includes('US Energy Information Administration'));
  // The facts it quotes come from the data, so the overlay cannot drift from the numbers.
  const s = normalizeState({ ...DEFAULT_STATE, mode: 'buy', buyGpu: 'b200' }, real);
  const f = buildFacts(s, real, evaluate(s, real));
  assert.equal(f.energyDefault, fmtUsdSmall(real.buyOptions.defaults.electricityUsdPerKwh));
  assert.equal(f.hoursPerMonth, String(real.buyOptions.defaults.hoursPerMonth));
  assert.equal(f.pue, String(real.buyOptions.defaults.pue));
  const d = real.buyOptions.defaults;
  const t = tipText('energy', f);
  assert.ok(t.includes('(' + d.pue + ') x ' + d.hoursPerMonth + ' hours') && t.includes(fmtUsdSmall(d.electricityUsdPerKwh) + ' by default'), t);
  // The row, the overlay of the card notes and the old row text now say the price is set in the controls and the notes hold the split.
  has('as.energy', ['in the controls', 'US commercial average', 'full power of the server for every hour of the month', 'power usage effectiveness']);
  assert.ok(!/The default is a US average/.test(TIPS['as.energy']), 'the row no longer reads as a fixed data number');
  has('self.notes', ['hardware', 'electricity', 'rack space', 'support']);
  has('as.power', ['charged for every hour of the month']);
  has('mode.buy', ['electricity, rack space and support', 'all 24 hours']);
  assert.equal(tipText('basis.set', {}), 'A number you set in the controls.');
});

test('accuracy band overlays call the band typical, not a bound', () => {
  // The band is the range most measured runs fell into (about 9 in 10 for the calibrated GPUs
  // when the model was in the fit, about 3 in 4 when it was left out), so the texts must not
  // promise that real speed stays inside it.
  for (const key of ['self.confidence', 'legend.band', 'chart.band']) {
    assert.match(TIPS[key], /Most measured runs/, key);
    assert.match(TIPS[key], /some (landed )?outside/, key);
    assert.ok(!/anywhere (from|in between)/.test(TIPS[key]), key + ' must not read as a bound');
  }
  assert.match(TIPS['self.confidence'], /typical, not as a limit/);
});
