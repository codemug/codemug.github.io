// Scales and path builders for the tokenomics charts. Pure number and string
// helpers; no DOM, no colours (CSS classes only, per UI-SPEC.md).

import { fmtStreams } from './format.mjs';
import { C_MIN } from './streams.mjs';

// A chart layout: viewBox size and margins (left, right, top, bottom) in SVG
// units, the width of one text character (the labels are monospace) and the x
// domain xMin..xMax on a log scale (decades = log10(xMax / xMin)); xMin is 0.01
// parallel streams. Desktop is 960x480 with a 844x400 plot area (l80 r36 t24
// b56). The phone layout is nearly square, so that a chart shrunk to a 360px
// screen keeps text that can be read; its left margin leaves room for the rotated
// y title. These two cover 0.01..10,000; use domainLayout for a shorter range.
function makeLayout(W, H, ML, MR, MT, MB, charW) {
  return { W, H, ML, MR, MT, MB, PW: W - ML - MR, PH: H - MT - MB, charW, xMin: C_MIN, xMax: 10000, decades: Math.log10(10000 / C_MIN) };
}
export const LAYOUTS = {
  desktop: makeLayout(960, 480, 80, 36, 24, 56, 9.6),
  phone: makeLayout(480, 440, 84, 30, 24, 60, 9),
};
export const DESKTOP = LAYOUTS.desktop;

// The same layout with the x axis running from 0.01 to xMax (a power of ten).
export function domainLayout(L, xMax) {
  return { ...L, xMax, decades: Math.log10(xMax / L.xMin) };
}

// At most 2 decimals, as a plain number.
export function r2(x) {
  return Number(x.toFixed(2));
}

// Log scale over C, from the layout's xMin to its xMax.
export function xLog(c, L = DESKTOP) {
  return L.ML + ((Math.log10(c) - Math.log10(L.xMin)) / L.decades) * L.PW;
}

// The decade ticks inside the layout's domain: 0.01, 0.1, 1, 10 ... xMax.
export function xTicks(L = DESKTOP) {
  const first = Math.round(Math.log10(L.xMin));
  return Array.from({ length: Math.round(L.decades) + 1 }, (_, i) => 10 ** (first + i));
}

// A tenth of a decade of room above and below the data, so dots and labels
// at the extremes are not on the frame.
const HEADROOM = 0.1;

// Log scale chosen from the data: min and max rounded out to powers of 10
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
  return { y, ticks };
}

// [c, value] pairs to [x, y] coordinates; non-positive, null or non-finite
// values become null coordinates.
export function coords(cs, values, scale, L = DESKTOP) {
  return cs.map((c, i) => {
    const v = values[i];
    return typeof v === 'number' && Number.isFinite(v) && v > 0 ? [r2(xLog(c, L)), r2(scale.y(v))] : null;
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
    const x = r2(xLog(t, L));
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
