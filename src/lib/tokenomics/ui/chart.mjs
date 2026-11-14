// SVG charts for the tokenomics page: monthly cost and cost per million
// output tokens, API versus self-hosted with the band, the crossover marker and
// the "you are here" marker. The horizontal range follows the parallel streams
// setting (chart-domain.mjs), on a log or a linear scale (chart-scale.mjs).
// Pure string builders; colours come from page CSS via classes only.

import { fmtUsd, fmtUsdAxis, fmtUsdSmall, fmtUsdTick, fmtStreams } from './format.mjs';
import { LAYOUTS, DESKTOP, domainLayout, r2, niceCeil, nearestIndex, xOf, yLogScale, yLinearScale, coords, polylinePoints, stepPath, bandPath, axes } from './chart-scale.mjs';
import { hereValues, markers } from './chart-here.mjs';

const NOTE = 'not offered for this combination';

// The layout a result is drawn in: the named layout over the result's x range,
// in the scale (log or linear) the result was sampled for.
export function chartLayout(result, name) {
  const sw = result.sweep || {};
  return domainLayout(LAYOUTS[name] ?? DESKTOP, sw.xMax || 10000, sw.scale === 'linear' ? 'linear' : 'log');
}

// Axis titles inside the SVG; the y label names the units plotted. data-ctip
// names the overlay text (the chart hover code reads it, see dom/chart-hover.mjs).
function axisTitles(perMtok, L) {
  const lin = L.scale === 'linear';
  const mode = lin ? '(linear scale)' : '(log scale)';
  const mid = r2(L.MT + L.PH / 2);
  const yLabel = (perMtok ? 'USD per million output tokens ' : 'USD per month ') + mode;
  const yTip = lin ? (perMtok ? 'chart.axis.y.mtok.linear' : 'chart.axis.y.monthly.linear') : (perMtok ? 'chart.axis.y.mtok' : 'chart.axis.y.monthly');
  return '<text class="chart-axis-title" data-ctip="' + (lin ? 'chart.axis.x.linear' : 'chart.axis.x') + '" x="' + r2(L.ML + L.PW / 2) + '" y="' + (L.H - 16) + '" text-anchor="middle">Parallel streams ' + mode + '</text>'
    + '<text class="chart-axis-title" data-ctip="' + yTip + '" x="14" y="' + mid + '" text-anchor="middle" transform="rotate(-90 14 ' + mid + ')">' + yLabel + '</text>';
}

// The series values at each C: api as given, self divided by mtokPerMonth
// for the per-million-tokens chart.
function series(result, perMtok) {
  const cs = result.sweep.cs;
  const api = perMtok ? cs.map(() => result.api.monthly.usdPerMtokOut) : result.sweep.api;
  const div = result.sweep.mtokPerMonth;
  const scale10 = (vals) => vals.map((v, i) => (v === null ? null : perMtok ? v / div[i] : v));
  return { cs, api, mid: scale10(result.sweep.selfMid), low: scale10(result.sweep.selfLow), high: scale10(result.sweep.selfHigh) };
}

const finite = (list) => list.filter((v) => typeof v === 'number' && Number.isFinite(v) && v > 0);

// The linear y axis: 0 to a round figure. Monthly cost: 1.1 times the largest
// of the API line, the self-hosting line and the slow end of the band. Cost per
// million tokens: the self-hosting curve explodes towards 0 streams, so the
// axis is fitted to twice the larger of the API line and the self-hosting value
// at your setting and at the middle of the range, and the curve runs off the top.
function linearY(s, here, perMtok, L) {
  const peaks = perMtok
    ? finite([s.api[0], here && here.api, here && here.self, s.mid[nearestIndex(s.cs, L.xMax / 2, 'linear')]])
    : finite([].concat(s.api, s.mid, s.high, here ? [here.api, here.self] : []));
  const peak = peaks.length ? Math.max(...peaks) : 1;
  return yLinearScale(niceCeil((perMtok ? 2 : 1.1) * peak), L);
}

// The series and the y scale a chart is drawn from: fitted to the visible
// curves and to the "you are here" figures. The hover code reads the same
// model so the crosshair sits exactly on the drawn lines.
export function chartModel(result, perMtok, L = DESKTOP) {
  const s = series(result, perMtok);
  const here = hereValues(result, perMtok);
  if (L.scale === 'linear') return { s, scale: linearY(s, here, perMtok, L) };
  const extra = here ? [here.api, here.self] : [];
  return { s, scale: yLogScale([].concat(s.api, s.mid, s.low, s.high, extra), L) };
}

// Sentence for <title> and <desc>: the numbers at the left end, the right end,
// the crossover and the chosen setting, so the chart reads without sight.
function describe(result, s, perMtok, L) {
  const fmt = perMtok ? fmtUsdSmall : fmtUsd;
  const i1 = s.cs.length - 1;
  const selfAt = (i) => (result.self.offered && s.mid[i] !== null ? ' and self-hosting ' + fmt(s.mid[i]) : '');
  let t = 'At C = ' + fmtStreams(s.cs[0]) + ' the API costs ' + fmt(s.api[0]) + selfAt(0);
  t += '; at C = ' + fmtStreams(s.cs[i1]) + ' the API costs ' + fmt(s.api[i1]) + selfAt(i1);
  const mid = result.crossover.mid;
  const cross = !result.self.offered ? 'Crossover: C = none.'
    : mid !== null ? 'Crossover at the expected speed: C = ' + fmtStreams(mid) + (mid > L.xMax ? ', beyond the right edge of this chart.' : '.')
    : 'No crossover at the expected speed within 0.01 to 10,000 parallel streams.';
  const here = hereValues(result, perMtok);
  const you = here ? ' Your setting: C = ' + fmtStreams(here.c) + ', the API costs ' + fmt(here.api)
    + (here.self === null ? '.' : ' and self-hosting ' + fmt(here.self) + '.') : '';
  return t + ' ' + cross + you;
}

// From the left edge of a linear chart (0 streams): the line starts at the origin
// for the API bill, and runs flat from the edge for the staircase (one replica).
const fromEdge = (list, y, L) => {
  if (L.scale !== 'linear' || list.length === 0 || !list[0]) return list;
  return [[r2(xOf(0, L)), y === null ? list[0][1] : y]].concat(list);
};

// The visible lines, band and wide invisible copies that a pointer can find.
function curves(result, s, scale, perMtok, L) {
  const apiList = coords(s.cs, s.api, scale, L).filter(Boolean);
  const apiC = fromEdge(apiList, perMtok ? null : r2(scale.y(0)), L);
  const apiTip = perMtok ? 'chart.api.mtok' : L.scale === 'linear' ? 'chart.api.monthly.linear' : 'chart.api.monthly';
  let body = '<polyline class="chart-api" fill="none" points="' + polylinePoints(apiC) + '"/>';
  let hits = '<polyline class="chart-hit" data-ctip="' + apiTip + '" points="' + polylinePoints(apiC) + '"/>';
  let under = '';
  if (result.self.offered) {
    const midC = fromEdge(coords(s.cs, s.mid, scale, L), null, L);
    const hi = coords(s.cs, s.high, scale, L);
    const lo = coords(s.cs, s.low, scale, L);
    const band = bandPath(fromEdge(hi, null, L), fromEdge(lo, null, L));
    if (band) under = '<polygon class="chart-self-band" data-ctip="chart.band" points="' + band + '"/>';
    // Dashed while the speed asked for is missed even with one request per GPU.
    body += '<path class="chart-self-mid' + (result.self.meetsSpeed === false ? ' chart-self-slow' : '') + '" fill="none" d="' + stepPath(midC) + '"/>';
    hits += '<path class="chart-hit" data-ctip="chart.self" d="' + stepPath(midC) + '"/>';
  }
  return { under, body, hits };
}

function vline(cls, x, L, extra = '') {
  return '<line class="' + cls + '"' + extra + ' x1="' + x + '" y1="' + L.MT + '" x2="' + x + '" y2="' + (L.MT + L.PH) + '"/>';
}

function markerSvg(m, L) {
  let out = '';
  if (m.cross) {
    const c = m.cross;
    out += vline('chart-cross', c.x, L) + vline('chart-hit', c.x, L, ' data-ctip="chart.cross"');
    out += '<text class="chart-cross-label" data-ctip="chart.cross" x="' + c.label.x + '" y="' + c.label.y + '" text-anchor="' + c.label.anchor + '">' + c.label.text + '</text>';
  }
  return out;
}

function hereSvg(h, L) {
  const dot = (cls, y) => (y === null ? '' : '<circle class="chart-here-dot ' + cls + '" data-ctip="chart.here" cx="' + h.x + '" cy="' + y + '" r="6"/>');
  return {
    line: vline('chart-here', h.x, L),
    top: vline('chart-hit', h.x, L, ' data-ctip="chart.here"') + dot('chart-here-api', h.yApi) + dot('chart-here-self', h.ySelf)
      + '<text class="chart-here-label" data-ctip="chart.here" x="' + h.label.x + '" y="' + h.label.y + '" text-anchor="' + h.label.anchor + '">' + h.label.text + '</text>',
  };
}

function chart(result, opts, perMtok) {
  const id = (opts && opts.idPrefix ? opts.idPrefix : 'chart') + (perMtok ? '-per-mtok-chart' : '-monthly-chart');
  const layoutName = opts && opts.layout === 'phone' ? 'phone' : 'desktop';
  const L = chartLayout(result, layoutName);
  const linear = L.scale === 'linear';
  // Log: monthly ticks are clean powers of ten; the per-mtok chart keeps 3 sig figs
  // (1,000 and up read as $1k). Linear: round figures from $0.
  const fmt = linear ? fmtUsdTick : perMtok ? (v) => (v >= 1000 ? fmtUsdAxis(v) : fmtUsdSmall(v)) : fmtUsdAxis;
  const { s, scale } = chartModel(result, perMtok, L);
  const desc = describe(result, s, perMtok, L);
  const titles = scale ? axisTitles(perMtok, L) : '';
  let body = scale ? axes(scale, fmt, L) : '';
  // The linear charts clip the curves to the plot: the self-hosting curve of the
  // per-million chart runs off the top at small numbers of streams.
  const clip = (g) => (linear ? '<g clip-path="url(#' + id + '-clip)">' + g + '</g>' : g);
  if (scale) {
    const m = markers(result, perMtok, scale, L);
    const c = curves(result, s, scale, perMtok, L);
    const here = m.here ? hereSvg(m.here, L) : { line: '', top: '' };
    body += clip(c.under) + here.line + clip(c.body + c.hits) + markerSvg(m, L) + here.top;
    // The crosshair the hover code moves; hidden until a pointer or key is on the plot.
    if (result.self.offered) body += '<g class="chart-hair-g" visibility="hidden">' + vline('chart-hair', 0, L) + '<circle class="chart-dot-api" r="5"/><circle class="chart-dot-self" r="5"/></g>';
  }
  if (!result.self.offered) {
    body += '<text class="chart-note" data-ctip="chart.note" x="' + r2(L.ML + L.PW / 2) + '" y="' + r2(L.MT + L.PH / 2) + '" text-anchor="middle">' + NOTE + '</text>';
  }
  const defs = linear ? '<defs><clipPath id="' + id + '-clip"><rect x="' + L.ML + '" y="' + L.MT + '" width="' + L.PW + '" height="' + L.PH + '"/></clipPath></defs>' : '';
  const title = perMtok ? 'Cost per million output tokens versus parallel streams' : 'Monthly cost versus parallel streams';
  return '<svg xmlns="http://www.w3.org/2000/svg" id="' + id + '" data-layout="' + layoutName + '" data-scale="' + L.scale + '" data-xmax="' + L.xMax + '" viewBox="0 0 ' + L.W + ' ' + L.H + '" role="img"' + (result.self.offered ? ' tabindex="0"' : '') + '><title>' + title + '</title><desc>' + desc + '</desc>' + defs + body + titles + '</svg>';
}

export function monthlyChartSvg(result, opts) {
  return chart(result, opts, false);
}

export function perMtokChartSvg(result, opts) {
  return chart(result, opts, true);
}
