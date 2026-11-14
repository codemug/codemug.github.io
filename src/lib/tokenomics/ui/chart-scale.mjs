// Scales and path builders for the tokenomics charts. Pure number and string
// helpers; no DOM, no colours (CSS classes only, per UI-SPEC.md).
//
// Two scale modes, chosen by layout.scale: 'log' (0.01 to xMax, a power of ten,
// with a log y axis) and 'linear' (0 to xMax, a round figure, with a linear y
// axis that starts at 0). xOf and cOf map between parallel streams and x; the
// y scale objects carry y(v) and the tick values, so the drawing code does not
// branch on the mode.

import { fmtStreams } from './format.mjs';
import { C_MIN } from './streams.mjs';

// A chart layout: viewBox size and margins (left, right, top, bottom) in SVG
// units, the width of one text character (the labels are monospace) and the x
// domain xMin..xMax (decades = log10(xMax / xMin) on the log scale). Desktop is
// 960x480 with a 844x400 plot area (l80 r36 t24 b56). The phone layout is
// nearly square, so that a chart shrunk to a 360px screen keeps text that can be
// read; its left margin leaves room for the rotated y title. These two cover the
// log range 0.01..10,000; use domainLayout for another range or for linear.
function makeLayout(W, H, ML, MR, MT, MB, charW) {
  return { W, H, ML, MR, MT, MB, PW: W - ML - MR, PH: H - MT - MB, charW, scale: 'log', xMin: C_MIN, xMax: 10000, decades: Math.log10(10000 / C_MIN) };
}
export const LAYOUTS = {
  desktop: makeLayout(960, 480, 80, 36, 24, 56, 9.6),
  phone: makeLayout(480, 440, 84, 30, 24, 60, 9),
};
export const DESKTOP = LAYOUTS.desktop;

// The same layout over another x range: on the log scale from 0.01 to xMax (a
// power of ten), on the linear scale from 0 to xMax (a round figure).
export function domainLayout(L, xMax, scale = 'log') {
  if (scale === 'linear') return { ...L, scale: 'linear', xMin: 0, xMax, decades: null };
  return { ...L, scale: 'log', xMin: C_MIN, xMax, decades: Math.log10(xMax / C_MIN) };
}

// At most 2 decimals, as a plain number.
export function r2(x) {
  return Number(x.toFixed(2));
}

const sig = (x, digits) => Number(x.toPrecision(digits));

// 1, 2 or 5 times a power of ten that is at least x.
export function niceCeil(x) {
  if (!(x > 0)) return 1;
  const e = Math.floor(Math.log10(x));
  const m = x / 10 ** e;
  const n = m <= 1 + 1e-9 ? 1 : m <= 2 + 1e-9 ? 2 : m <= 5 + 1e-9 ? 5 : 10;
  return sig(n * 10 ** e, 1);
}

// Tick values 0, step, 2 x step ... up to max, with a round step (1, 2 or 5
// times a power of ten) that lands on max when max is round, in 4 or 5 steps.
export function linearTicks(max) {
  let step = null;
  for (let e = -4; e <= 6 && step === null; e++) {
    for (const m of [1, 2, 5]) {
      const s = sig(m * 10 ** e, 1);
      const n = max / s;
      if (step === null && Math.abs(n - Math.round(n)) < 1e-9 && Math.round(n) >= 4 && Math.round(n) <= 5) step = s;
    }
  }
  if (step === null) step = niceCeil(max / 5);
  const out = [];
  for (let i = 0; i * step <= max * (1 + 1e-9); i++) out.push(sig(i * step, 6));
  return out;
}

// Parallel streams to x position, in the layout's scale.
export function xOf(c, L = DESKTOP) {
  if (L.scale === 'linear') return L.ML + ((c - L.xMin) / (L.xMax - L.xMin)) * L.PW;
  return L.ML + ((Math.log10(c) - Math.log10(L.xMin)) / L.decades) * L.PW;
}

// The other way: the parallel streams under an x position (clamped to the plot).
export function cOf(x, L = DESKTOP) {
  const t = Math.min(1, Math.max(0, (x - L.ML) / L.PW));
  if (L.scale === 'linear') return L.xMin + t * (L.xMax - L.xMin);
  return 10 ** (Math.log10(L.xMin) + t * L.decades);
}

// The x tick values: decades (0.01, 0.1, 1 ... xMax) on the log scale, round
// steps from 0 on the linear one.
export function xTicks(L = DESKTOP) {
  if (L.scale === 'linear') return linearTicks(L.xMax);
  const first = Math.round(Math.log10(L.xMin));
  return Array.from({ length: Math.round(L.decades) + 1 }, (_, i) => 10 ** (first + i));
}

// Index of the sample nearest to c: by log distance on the log scale, by plain
// distance on the linear one; the first on a tie.
export function nearestIndex(cs, c, mode = 'log') {
  const f = mode === 'linear' ? (v) => v : Math.log10;
  const target = f(c);
  let best = 0;
  let bestDist = Infinity;
  cs.forEach((v, i) => {
    const dist = Math.abs(f(v) - target);
    if (dist < bestDist) { bestDist = dist; best = i; }
  });
  return best;
}

// A tenth of a decade of room above and below the data, so dots and labels
// at the extremes are not on the frame.
const HEADROOM = 0.1;

// Log y scale chosen from the data: min and max rounded out to powers of 10
// (with the headroom above), ticks at each power of 10 in between.
export function yLogScale(values, L = DESKTOP) {
  const vals = values.filter((v) => typeof v === 'number' && Number.isFinite(v) && v > 0);
  if (vals.length === 0) return null;
  let eLo = Math.floor(Math.log10(Math.min(...vals)) - HEADROOM);
  let eHi = Math.ceil(Math.log10(Math.max(...vals)) + HEADROOM);
  if (eHi <= eLo) eHi = eLo + 1;
  const y = (v) => L.MT + (1 - (Math.log10(v) - eLo) / (eHi - eLo)) * L.PH;
  const ticks = [];
  for (let e = eLo; e <= eHi; e++) ticks.push(Math.pow(10, e));
  return { y, ticks, mode: 'log' };
}

// Linear y scale from 0 to max (a round figure), ticks in round steps.
export function yLinearScale(max, L = DESKTOP) {
  return { y: (v) => L.MT + (1 - v / max) * L.PH, ticks: linearTicks(max), mode: 'linear', max };
}

// [c, value] pairs to [x, y] coordinates; non-positive, null or non-finite
// values become null coordinates.
export function coords(cs, values, scale, L = DESKTOP) {
  return cs.map((c, i) => {
    const v = values[i];
    return typeof v === 'number' && Number.isFinite(v) && v > 0 ? [r2(xOf(c, L)), r2(scale.y(v))] : null;
  });
}

// "x,y x,y ..." for a <polyline points>; null coordinates skipped.
export function polylinePoints(coordinateList) {
  return coordinateList.filter(Boolean).map((p) => p[0] + ',' + p[1]).join(' ');
}

// Path for a step series: horizontal to the next x, then vertical.
export function stepPath(coordinateList) {
  const pts = coordinateList.filter(Boolean);
  if (pts.length === 0) return '';
  let d = 'M ' + pts[0][0] + ' ' + pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    d += ' L ' + pts[i][0] + ' ' + pts[i - 1][1] + ' L ' + pts[i][0] + ' ' + pts[i][1];
  }
  return d;
}

// Polygon points between the high and low series; '' when either has nulls.
export function bandPath(hi, lo) {
  if (hi.some((p) => !p) || lo.some((p) => !p)) return '';
  const top = hi.map((p) => p[0] + ',' + p[1]);
  const bottom = lo.map((p) => p[0] + ',' + p[1]).reverse();
  return top.concat(bottom).join(' ');
}

// Grid lines and tick labels for both axes; y labels use fmt.
export function axes(scale, fmt, L = DESKTOP) {
  let out = '';
  for (const t of xTicks(L)) {
    const x = r2(xOf(t, L));
    out += '<line class="chart-grid" x1="' + x + '" y1="' + L.MT + '" x2="' + x + '" y2="' + (L.MT + L.PH) + '"/>';
    out += '<text class="chart-tick" x="' + x + '" y="' + (L.MT + L.PH + 18) + '" text-anchor="middle">' + fmtStreams(t) + '</text>';
  }
  for (const t of scale.ticks) {
    const y = r2(scale.y(t));
    out += '<line class="chart-grid" x1="' + L.ML + '" y1="' + y + '" x2="' + (L.ML + L.PW) + '" y2="' + y + '"/>';
    out += '<text class="chart-tick" x="' + (L.ML - 8) + '" y="' + (y + 5) + '" text-anchor="end">' + fmt(t) + '</text>';
  }
  return out;
}
