// The horizontal range of both charts: it starts at 0.01 parallel streams and its
// right edge follows the parallel streams setting C, xMax(C). The curves are
// sampled only inside it. Pure.

import { C_MIN } from './streams.mjs';
import { niceCeil } from './chart-scale.mjs';

const X_FLOOR = 100;
const X_CAP = 10000;
const INTEGERS_UP_TO = 200;
const POINTS_PER_DECADE = 100;

const sig3 = (x) => Number(x.toPrecision(3));

// The right edge of the charts. Log scale: 10^ceil(log10(3 C)), kept between 100
// and 10,000 (C up to 33 shows 0.01 to 100, 34..333 shows 0.01 to 1,000 and 334
// and up shows 0.01 to 10,000). Linear scale: 3 C rounded up to 1, 2 or 5 times a
// power of ten (3 gives 10, 0.05 gives 0.2, 100 gives 500), at most 10,000.
// Without a usable C the whole range is shown.
export function xMaxFor(C, scale = 'log') {
  if (!Number.isFinite(C) || C <= 0) return X_CAP;
  if (scale === 'linear') return Math.min(X_CAP, niceCeil(3 * C));
  return Math.min(X_CAP, Math.max(X_FLOOR, 10 ** Math.ceil(Math.log10(3 * C))));
}

// The C values the curves are computed at for a domain 0.01..xMax (a power of
// ten): 100 log-spaced points per decade from 0.01 to 1 (so the idle region
// shows), every integer from 1 to 200 (so the steps of a small deployment show),
// then 100 log-spaced points per decade up to xMax. Strictly increasing, starts
// at 0.01 and ends at xMax.
export function sampleCs(xMax, scale = 'log') {
  if (scale === 'linear') return linearSampleCs(xMax);
  const out = [];
  const push = (c) => { if (out.length === 0 || c > out[out.length - 1]) out.push(c); };
  const lo = Math.log10(C_MIN);
  for (let i = 0; i < POINTS_PER_DECADE * -lo; i++) push(sig3(10 ** (lo + i / POINTS_PER_DECADE)));
  for (let c = 1; c <= Math.min(xMax, INTEGERS_UP_TO); c++) push(c);
  if (xMax > INTEGERS_UP_TO) {
    const from = Math.log10(INTEGERS_UP_TO);
    const to = Math.log10(xMax);
    const n = Math.ceil((to - from) * POINTS_PER_DECADE);
    for (let i = 1; i <= n; i++) push(Math.round(10 ** (from + ((to - from) * i) / n)));
  }
  return out;
}

// The linear view: 60 evenly spaced points below 1 (100 across the whole range
// when it ends below 1), then every integer from 1 to xMax when xMax is at most
// 1,000, else 1,000 evenly spaced points from 1 to xMax. Strictly increasing,
// ends at xMax, so every corner of the staircase is a sample.
function linearSampleCs(xMax) {
  const round = (x) => Number(x.toPrecision(6));
  const out = [];
  if (xMax < 1) {
    for (let i = 1; i <= 100; i++) out.push(round((xMax * i) / 100));
    return out;
  }
  for (let i = 1; i <= 60; i++) out.push(round(i / 61));
  if (xMax <= 1000) {
    for (let c = 1; c <= xMax; c++) out.push(c);
  } else {
    const n = 1000;
    for (let i = 0; i < n; i++) out.push(Math.round((1 + ((xMax - 1) * i) / (n - 1)) * 100) / 100);
  }
  return out;
}

// Where the crossover is searched: every 3-significant-digit value from 0.01 to
// 0.999 (the state's own resolution below 1), then every integer to 10,000.
export function crossoverCs() {
  const out = [];
  for (const scale of [0.0001, 0.001]) {
    for (let m = 100; m <= 999; m++) out.push(sig3(m * scale));
  }
  for (let c = 1; c <= X_CAP; c++) out.push(c);
  return out;
}
