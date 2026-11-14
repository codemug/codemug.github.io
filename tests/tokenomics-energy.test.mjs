// The electricity price is a page input (state.energyUsdPerKwh, hash key eprice):
// its state, link, effect on every buy cost the page computes, and the figures
// that show it. Uses the real data files. Run: node --test tests/tokenomics-energy.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEFAULT_STATE, normalizeState, toHash, fromHash } from '../src/lib/tokenomics/ui/state.mjs';
import { evaluate } from '../src/lib/tokenomics/ui/evaluate.mjs';
import { buildView } from '../src/lib/tokenomics/ui/view.mjs';
import { fmtUsd, fmtUsdSmall } from '../src/lib/tokenomics/ui/format.mjs';
import { basisKey, TIPS } from '../src/lib/tokenomics/ui/tips.mjs';
import * as calc from '../src/lib/tokenomics/calc.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const JR = (f) => JSON.parse(readFileSync(join(here, '../public/data/tokenomics/' + f), 'utf8'));
const real = { models: JR('models.json'), gpus: JR('gpus.json'), apiPrices: JR('api_prices.json'), rentOffers: JR('rent_offers.json'), buyOptions: JR('buy_options.json') };
const dataPrice = real.buyOptions.defaults.electricityUsdPerKwh;

const closeTo = (a, b) => assert.ok(Math.abs(a - b) <= Math.max(1e-9, Math.abs(b) * 1e-9), a + ' != ' + b);
// A normalized state; price undefined leaves the field out, as an old state or link does.
const st = (extra, price) => normalizeState({ ...DEFAULT_STATE, ...extra, ...(price === undefined ? {} : { energyUsdPerKwh: price }) }, real);
const buyB200 = (price) => st({ mode: 'buy', buyGpu: 'b200' }, price);
const buyRtx = (price) => st({ mode: 'buy', buyGpu: 'rtx6000pro', ctx: 32768 }, price);
const rent = (price) => st({ mode: 'rent' }, price);
// The same data with a different default price: the page must not read it.
const withDataPrice = (p) => ({ ...real, buyOptions: { ...real.buyOptions, defaults: { ...real.buyOptions.defaults, electricityUsdPerKwh: p } } });
const row = (view, label) => view.assumptions.find((a) => a.label === label);

// ---------- state ----------

test('energy state: the default equals the data default, so the page opens on the data price', () => {
  assert.equal(DEFAULT_STATE.energyUsdPerKwh, dataPrice, 'DEFAULT_STATE.energyUsdPerKwh must equal buy_options.json defaults.electricityUsdPerKwh');
  assert.equal(normalizeState(DEFAULT_STATE, real).energyUsdPerKwh, dataPrice);
  assert.equal(normalizeState({}, real).energyUsdPerKwh, dataPrice, 'a state without the field gets the default');
});

test('energy state: normalised to a finite number in 0 to 1 with at most 3 decimals, otherwise the default', () => {
  const norm = (x) => normalizeState({ ...DEFAULT_STATE, energyUsdPerKwh: x }, real).energyUsdPerKwh;
  assert.equal(norm(-0.5), 0, 'negative is raised to 0');
  assert.equal(norm(0), 0);
  assert.equal(norm(5), 1, 'above 1 is capped at 1');
  assert.equal(norm(1), 1);
  assert.equal(norm(0.1234), 0.123);
  assert.equal(norm(0.3), 0.3);
  assert.equal(norm(0.0004), 0);
  for (const junk of [NaN, Infinity, -Infinity, '0.3', null, undefined, {}, true]) assert.equal(norm(junk), dataPrice, String(junk) + ' falls back to the default');
});

test('energy state: eprice is written to the link only when it differs from the default', () => {
  assert.ok(!toHash(buyB200()).includes('eprice'), 'default price: not written');
  assert.ok(!toHash(buyB200(dataPrice)).includes('eprice'));
  assert.ok(!toHash(normalizeState(DEFAULT_STATE, real)).includes('eprice'));
  assert.match(toHash(buyB200(0.3)), /(^|&)eprice=0\.3(&|$)/);
  assert.match(toHash(buyB200(0)), /(^|&)eprice=0(&|$)/, 'zero is a real price and is written');
  assert.match(toHash(rent(0.3)), /(^|&)eprice=0\.3(&|$)/, 'the choice is kept while Rent is selected, so it is still there on switching back to Buy');
});

test('energy state: the link round trip returns the same state, with or without the leading hash sign', () => {
  for (const price of [0, 0.07, 0.123, 0.27, 0.3, 1]) {
    const s = buyB200(price);
    assert.deepStrictEqual(normalizeState(fromHash(toHash(s)), real), s, 'price ' + price);
    assert.deepStrictEqual(normalizeState(fromHash('#' + toHash(s)), real), s, 'price ' + price + ' with #');
    assert.equal(fromHash(toHash(s)).energyUsdPerKwh, price);
  }
  const d = normalizeState(DEFAULT_STATE, real);
  assert.deepStrictEqual(normalizeState(fromHash(toHash(d)), real), d);
});

test('energy state: old links without eprice open on the default price, and junk values fall back to it', () => {
  const old = '#shape=single&C=100&v=30&hoursPerDay=12&apiId=Anthropic%3Aclaude-sonnet-5-5&modelId=qwen3.8-27b&bits=4&ctx=32768&mode=buy&buyGpu=b200';
  assert.ok(!('energyUsdPerKwh' in fromHash(old)), 'nothing invented for an old link');
  const opened = normalizeState({ ...DEFAULT_STATE, ...fromHash(old) }, real);
  assert.equal(opened.energyUsdPerKwh, dataPrice);
  assert.equal(opened.mode, 'buy');
  for (const junk of ['#eprice=abc', '#eprice=', '#eprice=NaN', '#eprice=Infinity', '#eprice=%E0%A4%A', '#eprice=1e999']) {
    assert.deepEqual(fromHash(junk), {}, junk + ' is dropped');
    assert.equal(normalizeState({ ...DEFAULT_STATE, ...fromHash(junk) }, real).energyUsdPerKwh, dataPrice, junk);
  }
  const out = (hash) => normalizeState({ ...DEFAULT_STATE, ...fromHash(hash) }, real).energyUsdPerKwh;
  assert.equal(out('#eprice=5'), 1, 'a number out of range is capped, not dropped');
  assert.equal(out('#eprice=-2'), 0);
  assert.equal(out('#eprice=0.1234'), 0.123);
});

// ---------- evaluate: every buy cost uses the state price ----------

test('energy evaluate: doubling the price doubles the energy part and leaves the others, and the total moves by exactly the difference', () => {
  const lo = evaluate(buyB200(0.14), real);
  const hi = evaluate(buyB200(0.28), real);
  assert.ok(lo.self.offered && hi.self.offered);
  assert.equal(lo.self.servers, hi.self.servers);
  const rated = real.buyOptions.servers.find((x) => x.id === lo.self.serverId).powerKw;
  const d = real.buyOptions.defaults;
  closeTo(lo.self.parts.energy, lo.self.servers * rated * d.pue * d.hoursPerMonth * 0.14);
  closeTo(hi.self.parts.energy, 2 * lo.self.parts.energy);
  for (const k of ['amort', 'colo', 'support']) assert.equal(hi.self.parts[k], lo.self.parts[k], k + ' does not move with the price');
  closeTo(hi.self.usdPerMonth - lo.self.usdPerMonth, hi.self.parts.energy - lo.self.parts.energy);
  const sum = (r) => r.self.parts.amort + r.self.parts.energy + r.self.parts.colo + r.self.parts.support;
  closeTo(hi.self.usdPerMonth, sum(hi));
  const free = evaluate(buyB200(0), real);
  assert.equal(free.self.parts.energy, 0);
  closeTo(free.self.usdPerMonth, lo.self.parts.amort + lo.self.parts.colo + lo.self.parts.support);
});

test('energy evaluate: the data default is never read, so the whole result (card, sweep, accuracy band, crossover) follows the state price', () => {
  for (const make of [buyB200, buyRtx]) {
    const s = make(0.3);
    assert.deepStrictEqual(evaluate(s, real), evaluate(s, withDataPrice(99)), 'the data price makes no difference');
    assert.deepStrictEqual(evaluate(s, real), evaluate(s, withDataPrice(0)));
    // At the data price the result is what it was before the input existed.
    assert.deepStrictEqual(evaluate(make(dataPrice), real), evaluate(make(), real));
  }
});

test('energy evaluate: sweep, accuracy band and crossover move with the price', () => {
  const lo = evaluate(buyB200(0), real);
  const hi = evaluate(buyB200(1), real);
  for (const key of ['selfMid', 'selfLow', 'selfHigh']) {
    assert.equal(lo.sweep[key].length, hi.sweep[key].length);
    let dearer = 0;
    lo.sweep[key].forEach((x, i) => {
      assert.ok(hi.sweep[key][i] >= x, key + ' at point ' + i + ' never gets cheaper with dearer power');
      if (hi.sweep[key][i] > x) dearer++;
    });
    assert.ok(dearer > 0, key + ' is dearer somewhere');
  }
  // One sweep point written out with the calc functions and an explicit price: servers x rated kW x PUE x 730 x price on top.
  const s = buyB200(0.3);
  const r = evaluate(s, real);
  const d = { ...real.buyOptions.defaults, electricityUsdPerKwh: 0.3 };
  const i = r.sweep.cs.indexOf(106);
  assert.ok(i > 0, '106 is a sweep point');
  const model = real.models.find((m) => m.id === s.modelId);
  const gpu = real.gpus.find((g) => g.id === 'b200');
  const w = { isl: 0.9 * s.ctx, osl: 0.1 * s.ctx, cachedShare: 0.8 / 0.9 };
  const dep = calc.sizeDeployment({ model, bits: s.bits, gpu, C: 106, isl: w.isl, osl: w.osl, v: s.v, cachedShare: w.cachedShare, ctx: s.ctx, mtp: false, tf: 1 });
  const server = real.buyOptions.servers.find((x) => x.id === 'b200-8');
  closeTo(r.sweep.selfMid[i], calc.buyMonthly({ deployment: dep, server, defaults: d }).usdPerMonth);
  // The crossover is later when power costs more: the API has to be dearer before self-hosting wins.
  assert.ok(lo.crossover.mid !== null && hi.crossover.mid !== null, 'both cross within the grid');
  assert.ok(lo.crossover.mid < hi.crossover.mid, 'crossover ' + lo.crossover.mid + ' at $0 against ' + hi.crossover.mid + ' at $1');
});

test('energy evaluate: rent mode gives identical results for any price', () => {
  const base = evaluate(rent(), real);
  assert.ok(base.self.offered);
  for (const price of [0, 0.07, 0.3, 1]) {
    assert.deepStrictEqual(evaluate(rent(price), real), base, 'price ' + price);
    const a = buildView(evaluate(rent(price), real), rent(price), real);
    assert.deepStrictEqual(a, buildView(base, rent(), real), 'the view for price ' + price);
  }
});

// ---------- view: the note on the card and the assumptions row ----------

const NOTE = 'Of the monthly figure: ';
const noteFor = (r) => NOTE + 'hardware ' + fmtUsd(r.self.parts.amort) + ', electricity ' + fmtUsd(r.self.parts.energy)
  + ', rack space ' + fmtUsd(r.self.parts.colo) + ', support ' + fmtUsd(r.self.parts.support) + '.';
const notesOf = (view) => view.self.notes.filter((n) => n.startsWith(NOTE));

test('energy view: buy mode adds one note that splits the monthly figure into its four parts', () => {
  for (const price of [0.14, 0.3, 0]) {
    const s = buyB200(price);
    const r = evaluate(s, real);
    const view = buildView(r, s, real);
    assert.deepEqual(notesOf(view), [noteFor(r)], 'exactly one note for price ' + price);
  }
  const s = buyB200(0.3);
  const r = evaluate(s, real);
  const note = notesOf(buildView(r, s, real))[0];
  assert.match(note, /^Of the monthly figure: hardware \$[\d.]+k?, electricity \$[\d.]+k?, rack space \$[\d.]+k?, support \$[\d.]+k?\.$/);
  assert.ok(note.includes('electricity ' + fmtUsd(r.self.parts.energy)));
  assert.notEqual(note, notesOf(buildView(evaluate(buyB200(0.14), real), buyB200(0.14), real))[0], 'the electricity figure follows the price');
  assert.ok(!/[\u2013\u2014\u2018\u2019\u201C\u201D]/.test(note) && /^[\x20-\x7e]+$/.test(note), 'plain ASCII, no dashes or curly quotes');
});

test('energy view: the note keeps the card short, it is the only line added and it comes with the other notes', () => {
  const s = buyRtx(0.14);
  const view = buildView(evaluate(s, real), s, real);
  assert.equal(view.self.notes.length, 1, 'one note in total for a normal buy setup');
  // An estimated checkpoint keeps its own note, which stays first.
  const se = st({ mode: 'buy', buyGpu: 'b300', modelId: 'deepseek-v4.1-flash', bits: 16, ctx: 32768 });
  const re = evaluate(se, real);
  assert.equal(re.self.offered, true);
  const v = buildView(re, se, real);
  assert.equal(v.self.notes.length, 2);
  assert.match(v.self.notes[0], /^No checkpoint at this bit width exists/);
  assert.deepEqual(v.self.notes[1], noteFor(re));
});

test('energy view: rent mode and a setup that is not offered get no such note', () => {
  const rs = rent(0.3);
  assert.deepEqual(notesOf(buildView(evaluate(rs, real), rs, real)), []);
  const none = normalizeState({ ...DEFAULT_STATE, mode: 'buy', buyGpu: 'rtx6000pro', modelId: 'kimi-k3.1-pro', energyUsdPerKwh: 0.3 }, real);
  const rn = evaluate(none, real);
  assert.equal(rn.self.offered, false);
  assert.deepEqual(notesOf(buildView(rn, none, real)), []);
});

test('energy view: the assumptions row shows the state price, "set in the controls" when it is not the data price', () => {
  const dataBasis = real.buyOptions.defaults.basis.electricityUsdPerKwh.kind;
  const at = (price) => row(buildView(evaluate(buyB200(price), real), buyB200(price), real), 'Energy price');
  const def = at();
  assert.equal(def.value, fmtUsdSmall(dataPrice) + ' per kWh');
  assert.equal(def.basis, dataBasis, 'the data basis, as before');
  assert.equal(def.key, 'as.energy');
  const set = at(0.3);
  assert.equal(set.value, fmtUsdSmall(0.3) + ' per kWh');
  assert.equal(set.value, '$0.3 per kWh');
  assert.equal(set.basis, 'set in the controls');
  assert.equal(basisKey(set.basis), 'basis.set');
  assert.ok(TIPS[basisKey(set.basis)]);
  assert.equal(at(0).value, '$0 per kWh');
  assert.equal(at(0).basis, 'set in the controls');
  assert.equal(at(0.123).value, '$0.123 per kWh');
  assert.equal(at(dataPrice).basis, dataBasis, 'typing the data price back gives the data basis back');
  assert.equal(row(buildView(evaluate(rent(0.3), real), rent(0.3), real), 'Energy price'), undefined, 'rent has no energy row');
});
