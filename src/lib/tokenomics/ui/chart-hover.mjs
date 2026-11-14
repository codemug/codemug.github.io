// The pure side of the chart crosshair: pointer position to the nearest sweep
// point, the numbers at that point, and the readout text. No DOM; the event
// wiring is in dom/chart-hover.mjs.

import { fmtUsd, fmtUsdSmall, fmtInt, streamsPhrase } from './format.mjs';
import { DESKTOP, xLog, r2 } from './chart-scale.mjs';
import { chartModel } from './chart.mjs';

// C (a float) under a viewBox x position, clamped to the visible range 0.01..L.xMax.
// L is the chart layout over that range (see chartLayout in chart.mjs).
export function cFromX(x, L = DESKTOP) {
  const t = Math.min(1, Math.max(0, (x - L.ML) / L.PW));
  return 10 ** (Math.log10(L.xMin) + t * L.decades);
}

export function inPlot(x, y, L = DESKTOP) {
  return x >= L.ML && x <= L.ML + L.PW && y >= L.MT && y <= L.MT + L.PH;
}

// Index of the sweep point nearest to c on the log scale; the first on a tie.
export function nearestIndex(cs, c) {
  const lc = Math.log10(c);
  let best = 0;
  let bestDist = Infinity;
  cs.forEach((v, i) => {
    const dist = Math.abs(Math.log10(v) - lc);
    if (dist < bestDist) { bestDist = dist; best = i; }
  });
  return best;
}

// The next index in a direction whose C differs (a sample list may repeat a C).
export function stepIndex(cs, i, dir) {
  let j = i + dir;
  while (j >= 0 && j < cs.length && cs[j] === cs[i]) j += dir;
  return j < 0 || j >= cs.length ? i : j;
}

// The numbers at sweep point i, straight from the sweep arrays: monthly costs,
// the same divided by million output tokens, and the machines behind them.
// fast = the GPUs run at the fast end of the band (cheaper), slow = the slow end.
export function readoutValues(result, i) {
  const sw = result.sweep;
  const div = sw.mtokPerMonth[i];
  const per = (v) => (v === null ? null : v / div);
  const monthly = { api: sw.api[i], mid: sw.selfMid[i], fast: sw.selfLow[i], slow: sw.selfHigh[i] };
  return {
    c: sw.cs[i],
    monthly,
    perMtok: { api: result.api.monthly.usdPerMtokOut, mid: per(monthly.mid), fast: per(monthly.fast), slow: per(monthly.slow) },
    replicas: sw.replicasMid[i] ?? null,
    units: sw.unitsMid[i] ?? null,
  };
}

// Where the crosshair and its two dots go (viewBox units) for sweep point i.
export function pointAt(result, perMtok, i, L = DESKTOP) {
  const { s, scale } = chartModel(result, perMtok, L);
  const y = (v) => (scale && typeof v === 'number' && v > 0 ? r2(scale.y(v)) : null);
  return { i, x: r2(xLog(s.cs[i], L)), yApi: y(s.api[i]), yMid: y(s.mid[i]) };
}

const word = (n, one, many) => fmtInt(n) + ' ' + (n === 1 ? one : many);

// The readout shown beside the crosshair, one fact per line.
export function readoutLines(result, perMtok, i) {
  const v = readoutValues(result, i);
  const lines = ['At ' + streamsPhrase(v.c)];
  if (!result.self.offered) return lines.concat(['API: ' + fmtUsd(v.monthly.api) + ' a month', 'Self-hosting is not offered for this combination.']);
  if (perMtok) {
    const p = v.perMtok;
    lines.push('API: ' + fmtUsdSmall(p.api) + ' per million output tokens');
    lines.push('Self-hosting: ' + fmtUsdSmall(p.mid) + ' per million (' + fmtUsdSmall(p.fast) + ' if the GPUs are faster, ' + fmtUsdSmall(p.slow) + ' if slower)');
  }
  const m = v.monthly;
  lines.push('API: ' + fmtUsd(m.api) + ' a month');
  lines.push('Self-hosting: ' + fmtUsd(m.mid) + ' a month at the expected speed');
  lines.push('If the GPUs are faster: ' + fmtUsd(m.fast) + '. If slower: ' + fmtUsd(m.slow) + '.');
  if (v.units !== null) {
    const unit = result.self.machines !== null ? ['machine', 'machines'] : ['server', 'servers'];
    lines.push('Needs ' + word(v.units, unit[0], unit[1]) + ' (' + word(v.replicas, 'replica', 'replicas') + ')');
  }
  return lines;
}
