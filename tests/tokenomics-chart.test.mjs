// Chart tests for the tokenomics page: the SVG builders in ui/chart.mjs.
// Test data is built from tests/fixtures/tokenomics/fixtures.json, the same
// shape the ui tests use. Run: node --test tests/tokenomics-chart.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEFAULT_STATE, normalizeState } from '../src/lib/tokenomics/ui/state.mjs';
import { evaluate } from '../src/lib/tokenomics/ui/evaluate.mjs';
import { monthlyChartSvg, perMtokChartSvg } from '../src/lib/tokenomics/ui/chart.mjs';
import { cFromX, inPlot, nearestIndex, stepIndex, pointAt, readoutValues, readoutLines } from '../src/lib/tokenomics/ui/chart-hover.mjs';
import { LAYOUTS, domainLayout, xLog, xTicks, r2 } from '../src/lib/tokenomics/ui/chart-scale.mjs';
import { chartLayout, chartModel } from '../src/lib/tokenomics/ui/chart.mjs';
import { xMaxFor, sampleCs, crossoverCs } from '../src/lib/tokenomics/ui/chart-domain.mjs';
import { markers, labelExtent } from '../src/lib/tokenomics/ui/chart-here.mjs';
import { fmtUsd, fmtUsdSmall, fmtStreams, streamsPhrase } from '../src/lib/tokenomics/ui/format.mjs';
import { TIPS } from '../src/lib/tokenomics/ui/tips.mjs';

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

test('chart: svg output with series classes, ids, and the not-offered note', () => {
  const s = normalizeState({ ...DEFAULT_STATE, rentOfferId: 'x:h100x4' }, data);
  const res = evaluate(s, data);
  const m = monthlyChartSvg(res, { idPrefix: 'abc' });
  const p = perMtokChartSvg(res, { idPrefix: 'abc' });
  for (const [svg, id] of [[m, 'abc-monthly-chart'], [p, 'abc-per-mtok-chart']]) {
    assert.ok(svg.startsWith('<svg'), 'starts with <svg');
    assert.ok(svg.includes('viewBox="0 0 960 480"'), 'viewBox');
    assert.ok(svg.includes(id), 'id carries the prefix');
    for (const cls of ['chart-api', 'chart-self-band', 'chart-self-mid']) assert.ok(svg.includes(cls), cls + ' present');
    for (const bad of ['NaN', 'Infinity', 'undefined']) assert.ok(!svg.includes(bad), bad + ' absent');
  }
  assert.ok(m.includes('Parallel streams (log scale)') && m.includes('USD per month (log scale)'), 'monthly axis titles');
  assert.ok(p.includes('USD per million output tokens (log scale)'), 'per-mtok y title');
  const m2 = monthlyChartSvg({ ...res, crossover: { low: 7, mid: 30, high: 50 } }, { idPrefix: 'mk' });
  assert.ok(m2.includes('>C = 30<') && !m2.includes('>C = 7<') && !m2.includes('>C = 50<'), 'marker at the expected speed only');
  assert.ok(m2.includes('Crossover at the expected speed: C = 30.'), 'desc follows the expected speed');
  const m3 = monthlyChartSvg({ ...res, crossover: { low: 7, mid: null, high: null } }, { idPrefix: 'mk' });
  assert.ok(!m3.includes('chart-cross'), 'no marker when mid is null');
  assert.ok(m3.includes('No crossover at the expected speed within 0.01 to 10,000 parallel streams.'), 'desc when mid is null');
  const k = normalizeState({ ...DEFAULT_STATE, modelId: 'kimi-k3.1-pro', bits: 4, rentProvider: 'Lambda', rentOfferId: 'x:b200x8' }, data);
  const nk = monthlyChartSvg(evaluate(k, data), { idPrefix: 'zz' });
  assert.ok(nk.includes('not offered for this combination'), 'note present');
  assert.ok(nk.includes('class="chart-api"'), 'the API line is still drawn');
  for (const cls of ['chart-self-band', 'chart-self-mid']) assert.ok(!nk.includes(cls), cls + ' absent');
});

test('chart: monthly y-axis ticks are clean powers of ten', () => {
  const s = normalizeState({ ...DEFAULT_STATE, rentOfferId: 'x:h100x4' }, data);
  const svg = monthlyChartSvg(evaluate(s, data), { idPrefix: 'axis' });
  const yLabels = [...svg.matchAll(/<text class="chart-tick" x="72"[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);
  assert.ok(yLabels.length > 0 && yLabels.some((t) => /\$10M|\$1M/.test(t)), 'clean power label');
  assert.ok(yLabels.every((t) => !t.includes('.00M') && !t.includes('.0k')), 'no trailing zeros');
});

// ---- crosshair: nearest C, readout values, readout text ----
const rentState = normalizeState({ ...DEFAULT_STATE, rentOfferId: 'x:h100x4' }, data);
const rentRes = evaluate(rentState, data);
const buyRes = evaluate(normalizeState({ ...DEFAULT_STATE, mode: 'buy', buyGpu: 'rtx6000pro' }, data), data);
const notOffered = evaluate(normalizeState({ ...DEFAULT_STATE, modelId: 'kimi-k3.1-pro', bits: 4, rentProvider: 'Lambda', rentOfferId: 'x:b200x8' }, data), data);

test('hover: cFromX inverts the log x scale and clamps outside the plot, on both layouts', () => {
  for (const L of Object.values(LAYOUTS)) {
    for (const c of [0.01, 0.05, 0.1, 1, 10, 100, 1000, 10000]) assert.ok(Math.abs(cFromX(xLog(c, L), L) - c) / c < 1e-9, 'round trip at ' + c);
    assert.equal(cFromX(L.ML - 50, L), L.xMin);
    assert.equal(L.xMin, 0.01, 'the chart starts at 0.01 parallel streams');
    assert.ok(Math.abs(cFromX(L.ML + L.PW + 50, L) - 10000) < 1e-6);
    assert.ok(inPlot(L.ML + 1, L.MT + 1, L) && !inPlot(L.ML - 1, L.MT + 1, L) && !inPlot(L.ML + 1, L.MT + L.PH + 1, L));
  }
});

test('hover: nearestIndex picks the closest sweep point on the log scale, fractions included', () => {
  const cs = rentRes.sweep.cs;
  assert.equal(cs[0], 0.01);
  assert.equal(cs[cs.length - 1], 1000, 'C = 100 shows 0.01 to 1,000');
  const last = cs.length - 1;
  for (const i of [0, 20, 150, 250, 400, last]) assert.equal(cs[nearestIndex(cs, cs[i])], cs[i], 'exact C ' + cs[i]);
  assert.equal(nearestIndex(cs, 0.01), 0);
  assert.equal(cs[nearestIndex(cs, 1)], 1);
  for (const want of [0.0731, 0.3, 0.55]) {
    const got = cs[nearestIndex(cs, want)];
    assert.ok(Math.abs(Math.log10(got) - Math.log10(want)) <= 0.0051, 'the nearest sample to ' + want + ' is ' + got + ' (the grid steps 0.01 of a decade)');
  }
  assert.equal(nearestIndex(cs, 1000), last);
  assert.equal(nearestIndex(cs, 0.001), 0, 'below the range');
  assert.equal(nearestIndex(cs, 99999), last, 'above the range');
  const i = 100;
  assert.equal(cs[nearestIndex(cs, cs[i] * 1.001)], cs[i]);
  assert.equal(cs[nearestIndex(cs, cs[i] / 1.001)], cs[i]);
  // Between two samples it is the nearer one in log distance.
  const mid = Math.sqrt(cs[i] * cs[i + 1]);
  assert.equal(nearestIndex(cs, mid * 1.0001), i + 1);
  assert.equal(nearestIndex(cs, mid / 1.0001), i);
  // Every sample is nearest to its own x position on the chart, in the chart's own range.
  const L = chartLayout(rentRes, 'desktop');
  for (let n = 0; n <= last; n++) assert.equal(nearestIndex(cs, cFromX(xLog(cs[n], L), L)), n);
});

test('hover: stepIndex walks one visible sample at a time and stays at the ends', () => {
  const cs = rentRes.sweep.cs;
  assert.equal(stepIndex(cs, 0, 1), 1);
  assert.equal(stepIndex(cs, 0, -1), 0);
  assert.equal(stepIndex(cs, cs.length - 1, 1), cs.length - 1);
  assert.equal(stepIndex(cs, 50, 1), 51);
  assert.equal(stepIndex(cs, 50, -1), 49);
  // A list that repeats a value is stepped over, not through.
  assert.equal(stepIndex([1, 1, 1, 2, 3], 0, 1), 3);
  assert.equal(stepIndex([1, 1, 1, 2, 3], 3, -1), 2);
  assert.equal(stepIndex([1, 1, 1, 2, 3], 2, -1), 2, 'already at the first');
  // Walking from the first to the last point visits only visible Cs.
  let i = 0; let steps = 0;
  while (stepIndex(cs, i, 1) !== i) { i = stepIndex(cs, i, 1); steps += 1; }
  assert.equal(steps, cs.length - 1);
  assert.equal(cs[i], rentRes.sweep.xMax);
});

test('hover: readout values are the sweep arrays (monthly), divided by million tokens (per mtok)', () => {
  for (const res of [rentRes, buyRes]) {
    const sw = res.sweep;
    for (const i of [0, 7, 40, 63, 79]) {
      const v = readoutValues(res, i);
      assert.equal(v.c, sw.cs[i]);
      assert.deepEqual(v.monthly, { api: sw.api[i], mid: sw.selfMid[i], fast: sw.selfLow[i], slow: sw.selfHigh[i] });
      assert.equal(v.replicas, sw.replicasMid[i]);
      assert.equal(v.units, sw.unitsMid[i]);
      assert.equal(v.perMtok.api, res.api.monthly.usdPerMtokOut);
      assert.equal(v.perMtok.mid, sw.selfMid[i] / sw.mtokPerMonth[i]);
      assert.equal(v.perMtok.slow, sw.selfHigh[i] / sw.mtokPerMonth[i]);
    }
  }
});

test('hover: machines (rent) and servers (buy) behind each point come from the cost model', () => {
  const offer = data.rentOffers.find((o) => o.id === 'x:h100x4');
  const g = rentRes.self.g;
  rentRes.sweep.replicasMid.forEach((rep, i) => {
    assert.equal(rentRes.sweep.unitsMid[i], Math.ceil(rep / Math.floor(offer.gpuCount / g)), 'machines at C = ' + rentRes.sweep.cs[i]);
  });
  assert.equal(buyRes.sweep.unitsMid.length, buyRes.sweep.cs.length);
  buyRes.sweep.unitsMid.forEach((n, i) => assert.ok(Number.isInteger(n) && n >= 1 && n <= buyRes.sweep.replicasMid[i], 'servers at C = ' + buyRes.sweep.cs[i]));
  assert.deepEqual(notOffered.sweep.unitsMid, []);
});

test('hover: the crosshair dot sits on the drawn API line, on both layouts', () => {
  const i = rentRes.sweep.cs.indexOf(25);
  for (const name of ['desktop', 'phone']) {
    const L = chartLayout(rentRes, name);
    const p = pointAt(rentRes, false, i, L);
    assert.equal(p.x, r2(xLog(rentRes.sweep.cs[i], L)), name + ' x');
    assert.ok(p.yApi >= L.MT && p.yApi <= L.MT + L.PH && p.yMid >= L.MT && p.yMid <= L.MT + L.PH, name + ' y inside the plot');
    const svg = monthlyChartSvg(rentRes, { layout: name });
    const pts = svg.match(/<polyline class="chart-api"[^>]*points="([^"]*)"/)[1].split(' ');
    assert.ok(pts.includes(p.x + ',' + p.yApi), name + ' the dot sits on the API line');
  }
});

test('hover: readout lines show both bills, the band ends and the machines', () => {
  const i = rentRes.sweep.cs.indexOf(25);
  const v = readoutValues(rentRes, i);
  const text = readoutLines(rentRes, false, i).join('\n');
  for (const part of ['At ' + streamsPhrase(v.c), 'API: ' + fmtUsd(v.monthly.api) + ' a month', 'Self-hosting: ' + fmtUsd(v.monthly.mid) + ' a month at the expected speed', 'If the GPUs are faster: ' + fmtUsd(v.monthly.fast), 'If slower: ' + fmtUsd(v.monthly.slow), 'Needs ' + v.units + ' machines (' + v.replicas + ' replicas)']) {
    assert.ok(text.includes(part), part + ' in ' + text);
  }
  const per = readoutLines(rentRes, true, i).join('\n');
  assert.ok(per.includes('API: ' + fmtUsdSmall(v.perMtok.api) + ' per million output tokens'));
  assert.ok(per.includes('Self-hosting: ' + fmtUsdSmall(v.perMtok.mid) + ' per million'));
  assert.ok(per.includes('API: ' + fmtUsd(v.monthly.api) + ' a month'), 'the second chart keeps the monthly figures');
  assert.ok(readoutLines(buyRes, false, i).join('\n').includes(' servers ('), 'buy mode counts servers');
  assert.ok(readoutLines(notOffered, false, 3).join('\n').includes('not offered'));
  for (const bad of ['NaN', 'undefined', 'null', 'Infinity']) assert.ok(!text.includes(bad) && !per.includes(bad), bad);
});

test('chart markup: tips, hit lines, crosshair group and the phone layout', () => {
  const svg = monthlyChartSvg(rentRes, { idPrefix: 'z' });
  const keys = [...svg.matchAll(/data-ctip="([^"]+)"/g)].map((m) => m[1]);
  for (const k of ['chart.api.monthly', 'chart.self', 'chart.band', 'chart.axis.x', 'chart.axis.y.monthly']) assert.ok(keys.includes(k), k);
  assert.ok(perMtokChartSvg(rentRes, { idPrefix: 'z' }).includes('data-ctip="chart.api.mtok"'));
  for (const k of new Set(keys)) assert.ok(TIPS[k] && TIPS[k].length > 0, 'registry text for ' + k);
  assert.ok(svg.includes('chart-hair-g') && svg.includes('tabindex="0"') && svg.includes('data-layout="desktop"'));
  const phone = monthlyChartSvg(rentRes, { idPrefix: 'z', layout: 'phone' });
  assert.ok(phone.includes('viewBox="0 0 480 440"') && phone.includes('data-layout="phone"'));
  for (const bad of ['NaN', 'Infinity', 'undefined']) assert.ok(!phone.includes(bad), bad);
  // No tick label runs off the right edge of the viewBox (5 characters, about 5 units each side at least).
  for (const [svgText, L] of [[svg, chartLayout(rentRes, 'desktop')], [phone, chartLayout(rentRes, 'phone')]]) {
    const last = svgText.match(/<text class="chart-tick" x="([\d.]+)" y="[\d.]+" text-anchor="middle">1,000</);
    assert.ok(last && Number(last[1]) + 30 <= L.W, 'the last x label fits in the viewBox');
  }
  const noneSvg = monthlyChartSvg(notOffered, { idPrefix: 'z' });
  assert.ok(!noneSvg.includes('chart-hair-g') && !noneSvg.includes('tabindex'), 'nothing to move when self-hosting is not offered');
  assert.ok(noneSvg.includes('data-ctip="chart.note"'));
});

// ---- the horizontal range follows C; the "you are here" marker ----
const atC = (C, extra = {}) => evaluate(normalizeState({ ...DEFAULT_STATE, rentOfferId: 'x:h100x4', C, ...extra }, data), data);
const BOUNDARY_CS = [1, 33, 34, 333, 334, 10000];
const xLabels = (svg) => [...svg.matchAll(/<text class="chart-tick" x="[\d.]+" y="[\d.]+" text-anchor="middle">([^<]*)</g)].map((m) => m[1]);

test('range: xMaxFor is 10^ceil(log10(3 C)) between 100 and 10,000', () => {
  const want = { 1: 100, 2: 100, 33: 100, 34: 1000, 333: 1000, 334: 10000, 3333: 10000, 3334: 10000, 10000: 10000 };
  for (const [C, xMax] of Object.entries(want)) assert.equal(xMaxFor(Number(C)), xMax, 'C = ' + C);
  for (const bad of [NaN, undefined, 0, -5]) assert.equal(xMaxFor(bad), 10000, 'no usable C shows the whole range');
  for (let C = 1; C <= 10000; C += 1) assert.ok(xMaxFor(C) >= Math.min(3 * C, 10000), 'range covers three times C = ' + C);
});

test('range: sampleCs runs from 0.01 to xMax, with fractions, every integer to 200, then log-spaced', () => {
  for (const xMax of [100, 1000, 10000]) {
    const cs = sampleCs(xMax);
    assert.equal(cs[0], 0.01);
    assert.equal(cs[cs.length - 1], xMax);
    assert.ok(cs.every((c, i) => i === 0 || c > cs[i - 1]), 'sorted and strictly increasing for ' + xMax);
    assert.ok(cs.every((c) => c >= 0.01 && c <= xMax), 'inside [0.01, xMax]');
    const below1 = cs.filter((c) => c < 1);
    assert.ok(below1.length >= 190 && below1.length <= 200, 'about 100 log-spaced points per decade from 0.01 to 1: ' + below1.length);
    assert.ok(cs.includes(0.1) && cs.includes(0.0102), 'fractions on the grid');
    const from1 = cs.slice(below1.length, below1.length + Math.min(xMax, 200));
    assert.ok(from1.every((c, i) => c === i + 1), 'every integer from 1 to ' + Math.min(xMax, 200));
    assert.ok(cs.length <= 600, 'at most 600 points for ' + xMax + ', got ' + cs.length);
  }
  assert.equal(sampleCs(100).length, sampleCs(100).filter((c) => c < 1).length + 100);
});

test('range: the crossover is searched at every 3-digit value below 1 and every integer above', () => {
  const all = crossoverCs();
  assert.equal(all[0], 0.01); assert.equal(all[all.length - 1], 10000);
  assert.ok(all.every((c, i) => i === 0 || c > all[i - 1]), 'strictly increasing');
  assert.ok(all.includes(0.0594) && all.includes(0.237) && all.includes(0.999) && all.includes(1) && all.includes(4321));
  assert.equal(all.filter((c) => c < 1).length, 1800);
  assert.equal(all.length, 1800 + 10000);
});

test('range: evaluate samples only the visible range, and the range changes across the boundaries', () => {
  const want = { 1: 100, 33: 100, 34: 1000, 333: 1000, 334: 10000, 10000: 10000 };
  for (const C of BOUNDARY_CS) {
    const res = atC(C);
    assert.equal(res.C, C);
    assert.equal(res.sweep.xMax, want[C], 'xMax at C = ' + C);
    assert.deepEqual(res.sweep.cs, sampleCs(want[C]));
    assert.equal(res.sweep.cs[res.sweep.cs.length - 1], want[C]);
  }
});

test('range: x ticks and gridlines stay inside the visible range and follow C', () => {
  assert.deepEqual(xTicks(domainLayout(LAYOUTS.desktop, 100)), [0.01, 0.1, 1, 10, 100]);
  assert.deepEqual(xTicks(domainLayout(LAYOUTS.desktop, 1000)), [0.01, 0.1, 1, 10, 100, 1000]);
  assert.deepEqual(xTicks(LAYOUTS.phone), [0.01, 0.1, 1, 10, 100, 1000, 10000]);
  const labels = {};
  for (const C of BOUNDARY_CS) {
    const res = atC(C);
    for (const name of ['desktop', 'phone']) {
      const L = chartLayout(res, name);
      for (const svg of [monthlyChartSvg(res, { layout: name }), perMtokChartSvg(res, { layout: name })]) {
        const grid = [...svg.matchAll(/<line class="chart-grid" x1="([\d.]+)" y1="[\d.]+" x2="([\d.]+)"/g)].filter((m) => m[1] === m[2]).map((m) => Number(m[1]));
        assert.equal(grid.length, xTicks(L).length, 'one vertical gridline per decade, C = ' + C);
        assert.ok(grid.every((x) => x >= L.ML - 0.01 && x <= L.ML + L.PW + 0.01), 'gridlines inside the plot');
        assert.deepEqual(xLabels(svg), xTicks(L).map(fmtStreams));
        assert.ok(svg.includes('data-xmax="' + L.xMax + '"'));
      }
    }
    labels[C] = xLabels(monthlyChartSvg(res, {})).join('|');
  }
  assert.equal(labels[1], labels[33]);
  assert.notEqual(labels[33], labels[34], 'C 33 to 34 changes the x axis labels');
  assert.equal(labels[34], labels[333]);
  assert.notEqual(labels[333], labels[334], 'C 333 to 334 changes the x axis labels');
  assert.equal(labels[334], labels[10000]);
  assert.deepEqual(labels[1].split('|'), ['0.01', '0.1', '1', '10', '100']);
  assert.deepEqual(labels[10000].split('|'), ['0.01', '0.1', '1', '10', '100', '1,000', '10,000']);
});

test('here: the marker is at x from C and its dots are at the exact figures of the result', () => {
  for (const C of [...BOUNDARY_CS, 337, 0.01, 0.05, 0.3]) {
    const res = atC(C);
    for (const name of ['desktop', 'phone']) {
      const L = chartLayout(res, name);
      for (const perMtok of [false, true]) {
        const { scale } = chartModel(res, perMtok, L);
        const here = markers(res, perMtok, scale, L).here;
        assert.equal(here.x, r2(xLog(C, L)), 'x from C = ' + C);
        assert.ok(here.x >= L.ML && here.x <= L.ML + L.PW, 'x inside the plot');
        assert.ok(here.x + 6 <= L.W && here.x - 6 >= 0, 'the dot is not clipped');
        const api = perMtok ? res.api.monthly.usdPerMtokOut : res.api.monthly.usdPerMonth;
        const self = perMtok ? res.self.usdPerMonth / (res.api.monthly.outputTokensPerMonth / 1e6) : res.self.usdPerMonth;
        assert.equal(res.self.usdPerMtokOut, res.self.usdPerMonth / (res.api.monthly.outputTokensPerMonth / 1e6));
        assert.equal(here.yApi, r2(scale.y(api)), 'API dot from the exact API figure');
        assert.equal(here.ySelf, r2(scale.y(self)), 'self-hosting dot from the exact self-hosting figure');
        for (const y of [here.yApi, here.ySelf]) assert.ok(y > L.MT && y < L.MT + L.PH, 'dots inside the plot, with headroom (C = ' + C + ')');
        assert.ok(['C = ' + fmtStreams(C), fmtStreams(C)].includes(here.label.text), 'the label names C: ' + here.label.text);
      }
    }
  }
  // Not on the sample grid: the dot still uses the exact C, not the nearest sample.
  const off = atC(337);
  assert.ok(!off.sweep.cs.includes(337));
  const L = chartLayout(off, 'desktop');
  assert.equal(markers(off, false, chartModel(off, false, L).scale, L).here.x, r2(xLog(337, L)));
});

test('here: only the API dot when self-hosting is not offered', () => {
  const L = chartLayout(notOffered, 'desktop');
  const here = markers(notOffered, false, chartModel(notOffered, false, L).scale, L).here;
  assert.equal(here.ySelf, null);
  assert.ok(here.yApi > L.MT && here.yApi < L.MT + L.PH);
  const svg = monthlyChartSvg(notOffered, {});
  assert.ok(svg.includes('chart-here-api') && !svg.includes('chart-here-self') && svg.includes('class="chart-here"'));
  assert.ok(svg.includes('Your setting: C = 100, the API costs ' + fmtUsd(notOffered.api.monthly.usdPerMonth) + '.'));
});

test('here: the labels never touch each other, and lines run through them only when the two lines are close', () => {
  const crossovers = [null, 1, 2, 3, 10, 30, 33, 100, 150, 334, 1000, 3000, 10000];
  const gap = (a, b) => a[1] + 6 <= b[0] || b[1] + 6 <= a[0];
  const near = (x, ext) => x > ext[0] - 2 && x < ext[1] + 2;
  let checked = 0;
  for (const C of [1, 2, 3, 10, 33, 34, 50, 100, 101, 333, 334, 1000, 5000, 9999, 10000]) {
    const base = atC(C);
    for (const name of ['desktop', 'phone']) {
      const L = chartLayout(base, name);
      const { scale } = chartModel(base, false, L);
      for (const mid of crossovers) {
        const res = { ...base, crossover: { low: mid, mid, high: null } };
        const { cross, here } = markers(res, false, scale, L);
        const eh = labelExtent(here.label, L);
        assert.ok(eh[0] >= L.ML && eh[1] <= L.W - 2, 'here label on the chart, right of the y axis (C ' + C + ', crossover ' + mid + ', ' + name + ')');
        if (mid === null || mid > L.xMax) { assert.equal(cross, null); continue; }
        const ec = labelExtent(cross.label, L);
        assert.ok(ec[0] >= L.ML && ec[1] <= L.W - 2, 'crossover label on the chart, right of the y axis');
        if (cross.label.row === here.label.row) assert.ok(gap(ec, eh), 'labels on one row are apart (C ' + C + ', crossover ' + mid + ', ' + name + ')');
        // A line can only run through a label when the two lines are closer than a label is wide.
        if (near(cross.x, eh) || near(here.x, ec)) assert.ok(Math.abs(here.x - cross.x) < 80, 'lines apart leave the labels clear (C ' + C + ', crossover ' + mid + ', ' + name + ')');
        checked += 1;
      }
    }
  }
  assert.ok(checked > 200);
});

test('here: the crossover line is drawn only inside the visible range', () => {
  const res = atC(10);
  assert.equal(res.sweep.xMax, 100);
  const inside = monthlyChartSvg({ ...res, crossover: { low: 50, mid: 50, high: null } }, {});
  assert.ok(inside.includes('class="chart-cross"') && inside.includes('>C = 50<'));
  const beyond = monthlyChartSvg({ ...res, crossover: { low: 150, mid: 150, high: null } }, {});
  assert.ok(!beyond.includes('chart-cross') && !beyond.includes('>C = 150<'), 'not drawn past the right edge');
  assert.ok(beyond.includes('Crossover at the expected speed: C = 150, beyond the right edge of this chart.'));
  const edge = monthlyChartSvg({ ...res, crossover: { low: 100, mid: 100, high: null } }, {});
  assert.ok(edge.includes('>C = 100<'), 'on the right edge is still drawn');
});

test('here: the svg draws the solid line, the dots and the label, and the desc says where you are', () => {
  const res = atC(100);
  const L = chartLayout(res, 'desktop');
  const svg = monthlyChartSvg(res, { idPrefix: 'q' });
  const x = r2(xLog(100, L));
  assert.ok(svg.includes('<line class="chart-here" x1="' + x + '"'), 'solid line at x from C');
  assert.equal((svg.match(/class="chart-here-dot /g) ?? []).length, 2);
  assert.ok(svg.includes('>C = 100<'));
  assert.ok((svg.match(/data-ctip="chart\.here"/g) ?? []).length >= 4, 'line hit area, two dots and the label point at the overlay');
  assert.ok(svg.includes('Your setting: C = 100, the API costs ' + fmtUsd(res.api.monthly.usdPerMonth) + ' and self-hosting ' + fmtUsd(res.self.usdPerMonth) + '.'));
  const per = perMtokChartSvg(res, { idPrefix: 'q' });
  assert.ok(per.includes('the API costs ' + fmtUsdSmall(res.api.monthly.usdPerMtokOut) + ' and self-hosting ' + fmtUsdSmall(res.self.usdPerMtokOut)));
  assert.ok(TIPS['chart.here'] && TIPS['legend.here']);
  // Moving C moves the line.
  const other = atC(300);
  assert.ok(monthlyChartSvg(other, {}).includes('<line class="chart-here" x1="' + r2(xLog(300, chartLayout(other, 'desktop'))) + '"'));
});
