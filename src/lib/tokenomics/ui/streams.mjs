// Parallel streams C: the AVERAGE number of requests in flight, so it can be
// below 1 (0.1 is a request being answered a tenth of the time). The range, its
// rounding and the log-scale slider that sets it. Pure.

export const C_MIN = 0.01;
export const C_MAX = 10000;

const SLIDER_STEPS = 1000;
const DECADES = Math.log10(C_MAX / C_MIN);

const sig = (x, digits) => Number(x.toPrecision(digits));

// C kept in [0.01, 10,000] and rounded to 3 significant digits
// (0.123456 is 0.123, 0.001 is 0.01, 20000 is 10000).
export function roundC(x) {
  return sig(Math.min(C_MAX, Math.max(C_MIN, x)), 3);
}

// Slider position 0..1000 to C on a log scale over 0.01..10,000. Two significant
// digits, so that the round numbers (0.01, 0.1, 1, 100, 10000) come back exactly.
export function posToC(pos) {
  const p = Math.min(SLIDER_STEPS, Math.max(0, Number(pos) || 0));
  return roundC(sig(10 ** (Math.log10(C_MIN) + (p / SLIDER_STEPS) * DECADES), 2));
}

export function cToPos(c) {
  const v = Math.min(C_MAX, Math.max(C_MIN, Number(c) || C_MIN));
  return Math.round(((Math.log10(v) - Math.log10(C_MIN)) / DECADES) * SLIDER_STEPS);
}
