// The chart scale switch: logarithmic (today's view) and linear. Real data files,
// no browser. Run: node --test tests/tokenomics-scale.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEFAULT_STATE, normalizeState, toHash, fromHash } from '../src/lib/tokenomics/ui/state.mjs';
import { evaluate } from '../src/lib/tokenomics/ui/evaluate.mjs';
import { buildView, CHART_CAPTION, LINEAR_CAPTION } from '../src/lib/tokenomics/ui/view.mjs';
import { xMaxFor, sampleCs } from '../src/lib/tokenomics/ui/chart-domain.mjs';
import { LAYOUTS, domainLayout, xOf, cOf, xTicks, niceCeil, linearTicks, nearestIndex, r2 } from '../src/lib/tokenomics/ui/chart-scale.mjs';
import { monthlyChartSvg, perMtokChartSvg, chartLayout, chartModel } from '../src/lib/tokenomics/ui/chart.mjs';
import { markers } from '../src/lib/tokenomics/ui/chart-here.mjs';
import { pointAt, readoutValues, readoutLines, cFromX, stepIndex } from '../src/lib/tokenomics/ui/chart-hover.mjs';
import { fmtUsdTick, fmtStreams } from '../src/lib/tokenomics/ui/format.mjs';
import { TIPS } from '../src/lib/tokenomics/ui/tips.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const rd = (f) => JSON.parse(readFileSync(join(here, '../public/data/tokenomics/' + f), 'utf8'));
const data = { models: rd('models.json'), gpus: rd('gpus.json'), apiPrices: rd('api_prices.json'), rentOffers: rd('rent_offers.json'), buyOptions: rd('buy_options.json'), meta: rd('meta.json') };
const at = (patch) => { const st = normalizeState({ ...DEFAULT_STATE, ...patch }, data); const res = evaluate(st, data); return { st, res, view: buildView(res, st, data) }; };
const lin = (patch) => at({ scale: 'linear', ...patch });

test('state: scale is log by default, linear only when asked, junk falls back to log', () => {
  assert.equal(DEFAULT_STATE.scale, 'log');
  assert.equal(normalizeState({ ...DEFAULT_STATE }, data).scale, 'log');
  assert.equal(normalizeState({ ...DEFAULT_STATE, scale: 'linear' }, data).scale, 'linear');
  for (const junk of ['banana', '', null, undefined, 3, 'LINEAR', 'logarithmic']) assert.equal(normalizeState({ ...DEFAULT_STATE, scale: junk }, data).scale, 'log', String(junk));
});

test('link: scale=linear is written only when it is not the default, and read back', () => {
  const logState = normalizeState({ ...DEFAULT_STATE }, data);
  const linState = normalizeState({ ...DEFAULT_STATE, scale: 'linear' }, data);
  assert.ok(!/scale=/.test(toHash(logState)), 'the default is not written');
  assert.ok(/(^|&)scale=linear(&|$)/.test(toHash(linState)));
  assert.deepStrictEqual(linState, normalizeState(fromHash(toHash(linState)), data));
  assert.deepStrictEqual(linState, normalizeState(fromHash('#' + toHash(linState)), data));
  assert.deepStrictEqual(logState, normalizeState(fromHash(toHash(logState)), data));
  assert.equal(fromHash('#scale=linear').scale, 'linear');
  assert.equal(fromHash('#scale=log').scale, 'log');
  assert.equal(fromHash('#scale=banana').scale, 'log', 'unknown values fall back to log');
  assert.equal(fromHash('#scale=').scale, 'log');
  assert.equal(fromHash('#C=3').scale, undefined, 'a link without scale leaves the default');
  assert.equal(normalizeState({ ...DEFAULT_STATE, ...fromHash('#C=3&scale=banana') }, data).scale, 'log');
});

test('scale functions: x and c round-trip in both modes and both layouts', () => {
  for (const name of ['desktop', 'phone']) {
    for (const [mode, xMax, cs] of [['log', 1000, [0.01, 0.05, 0.3, 1, 3, 100, 1000]], ['linear', 500, [0, 0.05, 0.3, 1, 3, 100, 500]], ['linear', 0.2, [0, 0.05, 0.2]], ['linear', 10000, [0, 1, 2500, 10000]]]) {
      const L = domainLayout(LAYOUTS[name], xMax, mode);
      for (const c of cs) {
        const x = xOf(c, L);
        assert.ok(x >= L.ML - 1e-9 && x <= L.ML + L.PW + 1e-9, mode + ' x inside the plot for ' + c);
        assert.ok(Math.abs(cOf(x, L) - c) <= Math.max(1e-9, c * 1e-9), mode + ' round trip at ' + c + ' (' + name + ')');
      }
      assert.ok(Math.abs(xOf(L.xMin, L) - L.ML) < 1e-9 && Math.abs(xOf(L.xMax, L) - (L.ML + L.PW)) < 1e-9, 'the edges');
      assert.equal(cOf(L.ML - 99, L), L.xMin); assert.ok(Math.abs(cOf(L.ML + L.PW + 99, L) - L.xMax) < 1e-9, 'clamped');
    }
  }
  // Linear x is equally spaced; log x is not.
  const l = domainLayout(LAYOUTS.desktop, 100, 'linear');
  assert.ok(Math.abs((xOf(50, l) - xOf(0, l)) - (xOf(100, l) - xOf(50, l))) < 1e-9);
  assert.equal(l.xMin, 0);
  assert.equal(domainLayout(LAYOUTS.desktop, 100, 'log').xMin, 0.01);
  assert.equal(LAYOUTS.desktop.scale, 'log');
});

test('xNice: 3 C rounded up to 1, 2 or 5 times a power of ten, at most 10,000', () => {
  const want = { 0.01: 0.05, 0.05: 0.2, 0.3: 1, 1: 5, 3: 10, 100: 500, 4000: 10000, 10000: 10000 };
  for (const [C, x] of Object.entries(want)) assert.equal(xMaxFor(Number(C), 'linear'), x, 'C = ' + C);
  for (const bad of [NaN, undefined, 0, -3]) assert.equal(xMaxFor(bad, 'linear'), 10000, 'no usable C');
  let prev = 0;
  for (const C of [0.01, 0.02, 0.05, 0.1, 0.3, 0.7, 1, 1.7, 3.3, 7, 33, 66, 100, 333, 667, 1000, 3333, 9999, 10000]) {
    const x = xMaxFor(C, 'linear');
    assert.ok(/^(0\.0*)?[125]0*$/.test(String(x)), 'a 1, 2 or 5 times a power of ten: ' + x);
    assert.ok(x >= 3 * C || x === 10000, 'covers three times C = ' + C);
    assert.ok(x >= prev, 'monotone');
    prev = x;
  }
  // The log rule is unchanged.
  assert.equal(xMaxFor(100), 1000); assert.equal(xMaxFor(100, 'log'), 1000); assert.equal(xMaxFor(0.05), 100);
  assert.deepEqual([0.15, 9, 300, 1, 12000, 0.0004, 5, 5.1].map(niceCeil), [0.2, 10, 500, 1, 20000, 0.0005, 5, 10]);
});

test('nice ticks: round steps from 0 that land on a round maximum', () => {
  const want = {
    0.2: [0, 0.05, 0.1, 0.15, 0.2], 0.5: [0, 0.1, 0.2, 0.3, 0.4, 0.5], 1: [0, 0.2, 0.4, 0.6, 0.8, 1], 2: [0, 0.5, 1, 1.5, 2], 5: [0, 1, 2, 3, 4, 5],
    10: [0, 2, 4, 6, 8, 10], 20: [0, 5, 10, 15, 20], 50: [0, 10, 20, 30, 40, 50], 100: [0, 20, 40, 60, 80, 100], 200: [0, 50, 100, 150, 200], 500: [0, 100, 200, 300, 400, 500],
    1000: [0, 200, 400, 600, 800, 1000], 2000: [0, 500, 1000, 1500, 2000], 10000: [0, 2000, 4000, 6000, 8000, 10000],
  };
  for (const [max, ticks] of Object.entries(want)) assert.deepEqual(linearTicks(Number(max)), ticks, 'max ' + max);
  for (const max of [3, 7, 123, 0.37]) {
    const t = linearTicks(max);
    assert.equal(t[0], 0); assert.ok(t.every((v) => v <= max + 1e-9) && t.length >= 3 && t.length <= 8, 'ticks for ' + max + ': ' + t);
  }
  assert.deepEqual(xTicks(domainLayout(LAYOUTS.desktop, 500, 'linear')), [0, 100, 200, 300, 400, 500]);
  assert.deepEqual(xTicks(domainLayout(LAYOUTS.desktop, 1000, 'log')), [0.01, 0.1, 1, 10, 100, 1000], 'log ticks stay decades');
  assert.deepEqual([0, 50, 250, 1500, 50000, 2000000, 0.5].map(fmtUsdTick), ['$0', '$50', '$250', '$1.5k', '$50k', '$2M', '$0.5']);
  assert.deepEqual(xTicks(domainLayout(LAYOUTS.desktop, 0.2, 'linear')).map(fmtStreams), ['0', '0.05', '0.1', '0.15', '0.2']);
});

test('linear sampling: every integer to xNice, 60 fractions below 1, evenly spaced beyond 1,000', () => {
  for (const C of [3, 100, 166]) {
    const x = xMaxFor(C, 'linear');
    const cs = sampleCs(x, 'linear');
    assert.ok(x <= 1000);
    assert.equal(cs.filter((c) => c < 1).length, 60);
    for (let n = 1; n <= x; n++) assert.ok(cs.includes(n), 'integer ' + n + ' for xNice ' + x);
    assert.equal(cs[cs.length - 1], x);
    assert.ok(cs.every((c, i) => i === 0 || c > cs[i - 1]), 'strictly increasing');
    assert.equal(cs.length, 60 + x);
  }
  const big = sampleCs(10000, 'linear');
  assert.equal(big.length, 1060); assert.equal(big[big.length - 1], 10000); assert.equal(big[60], 1);
  assert.ok(big.every((c, i) => i === 0 || c > big[i - 1]));
  assert.ok(big.slice(60).every((c, i, a) => i === 0 || c - a[i - 1] <= 10.02), 'spacing at most 10');
  const two = sampleCs(2000, 'linear');
  assert.equal(two.length, 1060); assert.ok(two.slice(60).every((c, i, a) => i === 0 || c - a[i - 1] <= 2.02));
  // Below one stream the whole range is 100 even steps, ending at the edge.
  const tiny = sampleCs(0.2, 'linear');
  assert.equal(tiny.length, 100); assert.equal(tiny[99], 0.2); assert.equal(tiny[0], 0.002);
  assert.ok(tiny.every((c, i) => i === 0 || c > tiny[i - 1]));
  // The log sampling is untouched.
  assert.equal(sampleCs(100)[0], 0.01); assert.equal(sampleCs(100, 'log').length, sampleCs(100).length);
  // evaluate samples for the scale of the state.
  const r = lin({ C: 100, ctx: 2000 }).res;
  assert.equal(r.sweep.scale, 'linear'); assert.equal(r.sweep.xMax, 500); assert.deepEqual(r.sweep.cs, sampleCs(500, 'linear'));
  for (const key of ['api', 'selfMid', 'selfLow', 'selfHigh', 'replicasMid', 'unitsMid', 'mtokPerMonth']) assert.equal(r.sweep[key].length, r.sweep.cs.length, key);
  assert.equal(at({ C: 100 }).res.sweep.scale, 'log');
});

test('linear sampling shows the real corners of the staircase', () => {
  for (const [patch, label] of [[{ C: 3, ctx: 2000 }, 'Simple 2,000, xNice 10'], [{ C: 100, ctx: 2000 }, 'Simple 2,000, xNice 500'], [{ C: 2500, ctx: 2000 }, 'Simple 2,000, xNice 10,000'], [{ C: 100, ctx: 32768 }, 'Simple 32,768'], [{ C: 3, ctx: 32768 }, 'Simple 32,768 small'], [{ C: 100, shape: 'detailed' }, 'Detailed']]) {
    const { res } = lin(patch);
    const sw = res.sweep; const Bv = res.self.Bv;
    let corners = 0;
    for (let i = 1; i < sw.cs.length; i++) {
      const dr = sw.replicasMid[i] - sw.replicasMid[i - 1];
      assert.ok(dr >= 0, label + ': replicas never fall');
      if (dr > 0) corners += 1;
      // Where the step is at least as wide as the spacing of the samples, no step is skipped.
      if (sw.cs[i] - sw.cs[i - 1] <= Bv) assert.ok(dr <= 1, label + ': a replica step skipped between C = ' + sw.cs[i - 1] + ' and ' + sw.cs[i]);
    }
    if (sw.xMax <= 1000) {
      // Integer samples: the replica count is exactly ceil(C / Bv) at every one of them.
      sw.cs.forEach((c, i) => assert.equal(sw.replicasMid[i], Math.ceil(c / Bv), label + ' replicas at C = ' + c));
    }
    // A staircase with a step narrower than the chart has corners on it.
    if (Bv < sw.xMax) assert.ok(corners >= 1, label + ' has a corner');
  }
});

test('linear markers and crosshair: coordinates equal the readout values', () => {
  for (const C of [0.05, 3, 100]) {
    const { res } = lin({ C, ctx: 2000 });
    for (const name of ['desktop', 'phone']) {
      const L = chartLayout(res, name);
      assert.equal(L.scale, 'linear');
      for (const perMtok of [false, true]) {
        const { s, scale } = chartModel(res, perMtok, L);
        const m = markers(res, perMtok, scale, L).here;
        const api = perMtok ? res.api.monthly.usdPerMtokOut : res.api.monthly.usdPerMonth;
        const self = perMtok ? res.self.usdPerMonth / (res.api.monthly.outputTokensPerMonth / 1e6) : res.self.usdPerMonth;
        assert.equal(m.x, r2(xOf(C, L)), 'marker x from C = ' + C);
        assert.ok(m.x >= L.ML && m.x <= L.ML + L.PW);
        assert.equal(m.yApi, r2(scale.y(api)), 'API dot from the exact figure');
        assert.equal(m.ySelf, r2(scale.y(self)), 'self-hosting dot from the exact figure');
        for (const y of [m.yApi, m.ySelf]) assert.ok(y >= L.MT && y <= L.MT + L.PH, 'dots inside the plot (C ' + C + ', ' + name + ', ' + (perMtok ? 'per mtok' : 'monthly') + ')');
        // The crosshair at a sample uses the readout numbers.
        for (const i of [0, 7, Math.floor(s.cs.length / 2), s.cs.length - 1]) {
          const v = readoutValues(res, i);
          const p = pointAt(res, perMtok, i, L);
          assert.equal(p.x, r2(xOf(v.c, L)));
          const a = perMtok ? v.perMtok.api : v.monthly.api;
          const mid = perMtok ? v.perMtok.mid : v.monthly.mid;
          assert.equal(p.yApi, r2(scale.y(a)));
          const py = scale.y(mid);
          assert.equal(p.yMid, py < L.MT - 0.5 ? null : r2(py), 'self-hosting dot at the readout value, or left out when above the chart');
          assert.ok(readoutLines(res, perMtok, i)[0].startsWith('At '));
        }
      }
    }
  }
});

test('linear charts: the API line starts at the origin, the staircase from the left edge, labels and axes say linear', () => {
  const { res } = lin({ C: 3, ctx: 2000 });
  const L = chartLayout(res, 'desktop');
  const svg = monthlyChartSvg(res, { idPrefix: 'q' });
  const api = svg.match(/<polyline class="chart-api"[^>]*points="([^"]*)"/)[1].split(' ')[0].split(',').map(Number);
  assert.deepEqual(api, [L.ML, L.MT + L.PH], 'API from (0 streams, $0)');
  const self = svg.match(/<path class="chart-self-mid[^"]*"[^>]*d="M ([\d.]+) ([\d.]+)/);
  assert.equal(Number(self[1]), L.ML, 'the staircase starts at 0 streams');
  assert.ok(svg.includes('Parallel streams (linear scale)') && svg.includes('USD per month (linear scale)') && !svg.includes('(log scale)'));
  assert.ok(perMtokChartSvg(res, {}).includes('USD per million output tokens (linear scale)'));
  assert.deepEqual([...svg.matchAll(/<text class="chart-tick" x="[\d.]+" y="[\d.]+" text-anchor="middle">([^<]*)</g)].map((m) => m[1]), ['0', '2', '4', '6', '8', '10']);
  assert.ok(svg.includes('data-scale="linear"') && svg.includes('data-xmax="10"'));
  for (const key of ['chart.axis.x.linear', 'chart.axis.y.monthly.linear', 'chart.api.monthly.linear']) assert.ok(svg.includes('data-ctip="' + key + '"'), key);
  const logSvg = monthlyChartSvg(at({ C: 3, ctx: 2000 }).res, {});
  for (const key of ['chart.axis.x', 'chart.axis.y.monthly', 'chart.api.monthly']) assert.ok(logSvg.includes('data-ctip="' + key + '"'), 'log keeps ' + key);
  assert.ok(logSvg.includes('(log scale)') && !logSvg.includes('clipPath') && logSvg.includes('data-scale="log"'));
  // y axis of the monthly chart: 0 up to a round figure at least 1.1 times the largest line.
  const sc = chartModel(res, false, L).scale;
  assert.equal(sc.ticks[0], 0); assert.ok(sc.max >= 1.1 * Math.max(...res.sweep.api, ...res.sweep.selfHigh));
  assert.ok(sc.ticks.every((t) => t <= sc.max + 1e-9));
});

test('linear charts: the per-million curves are clipped to the plot and the axis is fitted to two times the larger bill', () => {
  const { res } = lin({ C: 3, ctx: 2000 });
  const L = chartLayout(res, 'desktop');
  const svg = perMtokChartSvg(res, { idPrefix: 'q' });
  const clipId = svg.match(/<clipPath id="([^"]+)"><rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/);
  assert.ok(clipId, 'a clip path');
  assert.deepEqual(clipId.slice(2).map(Number), [L.ML, L.MT, L.PW, L.PH], 'it is the plot area');
  assert.ok(svg.includes('<g clip-path="url(#' + clipId[1] + ')">'), 'the curves are inside it');
  const { s, scale } = chartModel(res, true, L);
  // The y axis: 0 to a round figure that is at least twice the API line, the self-hosting figure at C and at the middle of the range.
  const midIdx = nearestIndex(s.cs, L.xMax / 2, 'linear');
  const need = 2 * Math.max(res.api.monthly.usdPerMtokOut, res.self.usdPerMtokOut, s.mid[midIdx]);
  assert.ok(scale.max >= need - 1e-9 && scale.max < 10 * need, 'fitted: ' + scale.max + ' for ' + need);
  // The curve does leave the top (so the clip is needed), and the lines that matter stay inside.
  const top = L.MT - 0.01;
  const selfD = svg.match(/<path class="chart-self-mid[^"]*"[^>]*d="([^"]*)"/)[1];
  const ys = [...selfD.matchAll(/(?:M|L) [\d.]+ (-?[\d.]+)/g)].map((m) => Number(m[1]));
  assert.ok(ys.some((y) => y < top), 'the curve runs off the top at small streams');
  assert.ok(ys.every((y) => Number.isFinite(y)));
  const apiYs = svg.match(/<polyline class="chart-api"[^>]*points="([^"]*)"/)[1].split(' ').map((p) => Number(p.split(',')[1]));
  assert.ok(apiYs.every((y) => y >= L.MT && y <= L.MT + L.PH), 'the API line is inside the plot');
  // The marker and its dots are inside the plot.
  const m = markers(res, true, scale, L).here;
  for (const y of [m.yApi, m.ySelf]) assert.ok(y >= L.MT && y <= L.MT + L.PH);
  // The monthly chart is clipped too, and nothing of the log charts is.
  assert.ok(monthlyChartSvg(res, { idPrefix: 'q' }).includes('clip-path'));
  assert.ok(!perMtokChartSvg(at({ C: 3, ctx: 2000 }).res, {}).includes('clip-path'));
});

test('linear charts: crossover, off-the-edge sentence, dashed line, and the not-offered chart', () => {
  // The crossover line is drawn when it is on the chart: Simple 2,000 crosses at 8, the chart runs to 10 at C = 3.
  const on = lin({ C: 3, ctx: 2000 });
  assert.equal(on.res.crossover.mid, 8);
  assert.ok(monthlyChartSvg(on.res, {}).includes('class="chart-cross"') && monthlyChartSvg(on.res, {}).includes('>C = 8<'));
  // At C = 0.05 the chart ends at 0.2, so the crossover at 8 is off the right edge: said in words, not drawn.
  const off = lin({ C: 0.05, ctx: 2000 });
  assert.equal(off.res.sweep.xMax, 0.2);
  assert.ok(!monthlyChartSvg(off.res, {}).includes('chart-cross'));
  assert.ok(monthlyChartSvg(off.res, {}).includes('beyond the right edge'));
  assert.ok(off.view.chartCaption.startsWith(LINEAR_CAPTION) && off.view.chartCaption.includes('self-hosting becomes cheaper from about 8 parallel streams'));
  assert.equal(on.view.chartCaption, LINEAR_CAPTION);
  assert.equal(at({ C: 3, ctx: 2000 }).view.chartCaption, CHART_CAPTION);
  assert.ok(LINEAR_CAPTION.includes('runs from 0 to about three times your parallel streams setting') && !CHART_CAPTION.includes('runs from 0'));
  // The speed warning dashes the staircase in the linear view too (the default 30 tokens per second is met now, 500 is not).
  const slow = lin({ C: 100, v: 500 });
  assert.equal(slow.res.self.meetsSpeed, false);
  assert.ok(monthlyChartSvg(slow.res, {}).includes('chart-self-mid chart-self-slow'));
  // Not offered: only the API line and the note.
  const none = lin({ modelId: 'kimi-k3.1-pro', rentProvider: 'AWS', rentOfferId: 'AWS:g7e.2xlarge:on_demand', C: 100 });
  assert.equal(none.res.self.offered, false);
  const svg = monthlyChartSvg(none.res, {});
  assert.ok(svg.includes('class="chart-api"') && !svg.includes('chart-self-mid') && svg.includes('data-ctip="chart.note"') && !svg.includes('chart-hair-g') && svg.includes('chart-here-api') && !svg.includes('chart-here-self'));
  const { scale } = chartModel(none.res, false, chartLayout(none.res, 'desktop'));
  assert.equal(scale.ticks[0], 0);
  assert.ok(Number.isFinite(scale.max) && scale.max > 0);
});

test('hover in linear: the pointer maps to the nearest sample, and stepping walks the samples', () => {
  const { res } = lin({ C: 100, ctx: 2000 });
  const L = chartLayout(res, 'desktop');
  const cs = res.sweep.cs;
  for (const i of [0, 30, 59, 60, 61, 200, cs.length - 1]) assert.equal(nearestIndex(cs, cFromX(xOf(cs[i], L), L), 'linear'), i, 'sample ' + cs[i]);
  assert.equal(cs[nearestIndex(cs, 250.4, 'linear')], 250);
  assert.equal(cs[nearestIndex(cs, 0.0001, 'linear')], cs[0]);
  assert.equal(nearestIndex(cs, 1e9, 'linear'), cs.length - 1);
  // The same distance means different neighbours on the two scales.
  assert.notEqual(nearestIndex([1, 10, 100], 40, 'linear'), nearestIndex([1, 10, 100], 40, 'log'));
  assert.equal(stepIndex(cs, 0, 1), 1);
  let i = 0; let steps = 0;
  while (stepIndex(cs, i, 1) !== i) { i = stepIndex(cs, i, 1); steps += 1; }
  assert.equal(steps, cs.length - 1); assert.equal(cs[i], 500);
});

test('overlay texts for the switch and the linear charts, in plain words', () => {
  const has = (key, parts) => { for (const part of parts) assert.ok(TIPS[key].includes(part), key + ' says "' + part + '"'); };
  has('scale', ['each gridline is 10 times the one before', 'whole range from 0.01 to 10,000 streams fits', 'a straight rising line means the cost grows in proportion', 'Linear means equal steps', 'API bill is a straight line through zero', 'self-hosting is a staircase']);
  has('chart.api.monthly.linear', ['straight line through zero', 'linear chart']);
  has('chart.axis.x.linear', ['linear scale from 0', 'about three times your number', '{xMax}']);
  has('chart.axis.y.monthly.linear', ['linear scale from $0']);
  has('chart.axis.y.mtok.linear', ['runs off the top', 'exact figure']);
  assert.ok(TIPS['chart.api.monthly'].includes('log chart'), 'the log text still says so');
  assert.ok(!TIPS['chart.api.monthly.linear'].includes('log'));
});
