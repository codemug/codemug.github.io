// The two vertical markers on a chart: the dashed crossover line and the solid
// "you are here" line at the chosen parallel streams C, with a dot on each
// cost line and a label. Pure geometry in SVG units; chart.mjs draws it.
//
// The dots use the exact figures of the result (the same numbers as the cost
// cards), not the sweep grid. The labels sit at the top of the plot; when the
// two lines are close, the labels move to another row or the other side of
// their line, so no label touches the other label or the other line.

import { r2, xOf } from './chart-scale.mjs';
import { fmtStreams } from './format.mjs';

const TOP = 14; // baseline of the first label row, below the top of the plot
const ROW = 20; // distance between two label rows
const SIDE = 4; // gap between a line and its label
const LABEL_PAD = 6; // clear space kept between two labels
const LINE_PAD = 2; // clear space kept between a line and a label

// The exact API figure and self-hosting figure at C, in the units a chart
// plots: per month, or per million output tokens. self is null when
// self-hosting is not offered.
export function hereValues(result, perMtok) {
  const c = result.C;
  if (!Number.isFinite(c) || c <= 0) return null;
  const m = result.api.monthly;
  const s = result.self;
  return {
    c,
    api: perMtok ? m.usdPerMtokOut : m.usdPerMonth,
    self: s.offered ? (perMtok ? s.usdPerMtokOut : s.usdPerMonth) : null,
  };
}

// Horizontal extent [left, right] of a label, from its anchor and text length.
export function labelExtent(label, L) {
  const w = label.text.length * L.charW;
  return label.anchor === 'end' ? [label.x - w, label.x] : [label.x, label.x + w];
}

function labelAt(x, text, anchor, row, L) {
  return { text, anchor, row, x: r2(x + (anchor === 'end' ? -SIDE : SIDE)), y: L.MT + TOP + row * ROW };
}

// Label positions to try for a line at x: its usual side first, then the other
// side, each on the top row and then on the second row; then the same with the
// short text (just the number) for when two lines are too close for the long one.
function options(line, L) {
  const pref = line.x > L.ML + L.PW / 2 ? 'end' : 'start';
  const other = pref === 'end' ? 'start' : 'end';
  return [line.text, line.short].flatMap((text) => [0, 1].flatMap((row) => [pref, other].map((a) => labelAt(line.x, text, a, row, L))));
}

const overlaps = (a, b) => a[0] < b[1] + LABEL_PAD && b[0] < a[1] + LABEL_PAD;
const touches = (x, ext) => x > ext[0] - LINE_PAD && x < ext[1] + LINE_PAD;
// A label may run into the right margin but never off the chart, and never over the y tick labels.
const insidePlot = (ext, L) => ext[0] >= L.ML && ext[1] <= L.W - 2;

// How bad a pair of label placements is: Infinity when a label leaves the chart
// or two labels on one row touch; otherwise the number of lines that run through
// a label. Two lines closer than a label is wide cannot avoid that, and the
// label then has a halo (see the CSS) so it stays readable.
function badness(cross, here, L) {
  const exts = [cross, here].filter(Boolean).map((m) => labelExtent(m.label, L));
  if (!exts.every((e) => insidePlot(e, L))) return Infinity;
  if (!cross || !here) return 0;
  const [ec, eh] = exts;
  if (cross.label.row === here.label.row && overlaps(ec, eh)) return Infinity;
  return (touches(cross.x, eh) ? 1 : 0) + (touches(here.x, ec) ? 1 : 0);
}

// Both markers for a result, or null for one that is not drawn. The crossover
// is drawn only when it is inside the visible range (L.xMax); the here marker
// needs the y scale for its dots.
export function markers(result, perMtok, scale, L) {
  const mid = result.crossover.mid;
  const crossLine = mid !== null && mid <= L.xMax ? { mid, x: r2(xOf(mid, L)), text: 'C = ' + fmtStreams(mid), short: fmtStreams(mid) } : null;
  const v = scale ? hereValues(result, perMtok) : null;
  const hereLine = v ? { c: v.c, x: r2(xOf(v.c, L)), text: 'C = ' + fmtStreams(v.c), short: fmtStreams(v.c) } : null;
  const crossOpts = crossLine ? options(crossLine, L) : [null];
  const hereOpts = hereLine ? options(hereLine, L) : [null];
  let pick = null;
  let best = Infinity;
  for (const c of crossOpts) {
    for (const h of hereOpts) {
      const a = c && { ...crossLine, label: c };
      const b = h && { ...hereLine, label: h };
      const bad = badness(a, b, L);
      if (bad < best) { best = bad; pick = [a, b]; }
    }
  }
  const [cross, here] = pick ?? [crossLine && { ...crossLine, label: crossOpts[0] }, hereLine && { ...hereLine, label: hereOpts[0] }];
  const clampY = (y) => r2(Math.min(L.MT + L.PH, Math.max(L.MT, y)));
  return {
    cross,
    here: here && { ...here, yApi: clampY(scale.y(v.api)), ySelf: v.self === null ? null : clampY(scale.y(v.self)) },
  };
}
