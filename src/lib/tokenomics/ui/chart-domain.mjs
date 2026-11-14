// The horizontal range of both charts: it starts at 0.01 parallel streams and its
// right edge follows the parallel streams setting C, xMax(C). The curves are
// sampled only inside it. Pure.

import { C_MIN } from './streams.mjs';

const X_FLOOR = 100;
const X_CAP = 10000;
const INTEGERS_UP_TO = 200;
const POINTS_PER_DECADE = 100;

const sig3 = (x) => Number(x.toPrecision(3));

// 10^ceil(log10(3 C)), kept between 100 and 10,000: C up to 33 shows 0.01 to
// 100, 34..333 shows 0.01 to 1,000 and 334 and up shows 0.01 to 10,000. Without
// a usable C the whole range is shown.
export function xMaxFor(C) {
  if (!Number.isFinite(C) || C <= 0) return X_CAP;
  return Math.min(X_CAP, Math.max(X_FLOOR, 10 ** Math.ceil(Math.log10(3 * C))));
}

// The C values the curves are computed at for a domain 0.01..xMax (a power of
// ten): 100 log-spaced points per decade from 0.01 to 1 (so the idle region
// shows), every integer from 1 to 200 (so the steps of a small deployment show),
// then 100 log-spaced points per decade up to xMax. Strictly increasing, starts
// at 0.01 and ends at xMax.
export function sampleCs(xMax) {
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
