// The workload a page state describes, in the form the cost and sizing code
// takes: the request's input and output tokens, the cached share of the input and
// the context reserved for every request. Pure.
//
// Simple and Detailed "Custom split": every request holds `ctx` tokens in total,
// split into cached input, new (uncached) input and output by percentages of the
// context: Simple fixes them at 80%, 10% and 10%; Custom split lets the reader set
// them. The same `ctx` is the memory reserved per request (the worst case).
// Detailed "Agent loop": the request is the average turn of the loop; the memory
// reserved is the largest context the loop reaches, capped at the model's window.
// Values stay fractional here (0.9 x 262,144 is 235,929.6); the page shows whole tokens.

import * as calc from '../calc.mjs';
import { fmtShare } from './format.mjs';

export const SIMPLE_SPLIT = { cachedPct: 80, outputPct: 10 };
export const MIN_CTX = 2000;
export const MIN_OUTPUT_PCT = 0.1;
export const MAX_OUTPUT_PCT = 99;

// "80% cached input, 10% new input and 10% output": what Simple fixes, in words.
export function simpleSplitText() {
  const newPct = 100 - SIMPLE_SPLIT.cachedPct - SIMPLE_SPLIT.outputPct;
  return fmtShare(SIMPLE_SPLIT.cachedPct) + ' cached input, ' + fmtShare(newPct) + ' new input and ' + fmtShare(SIMPLE_SPLIT.outputPct) + ' output';
}

const round6 = (x) => Number(x.toPrecision(12));

// A request of ctx tokens split by percentages of the context. cachedShare is the
// cached part of the INPUT: cached% / (100% - output%).
export function splitWorkload(ctx, split) {
  const out = split.outputPct / 100;
  const mix = { cachedPct: split.cachedPct, newPct: round6(100 - split.cachedPct - split.outputPct), outputPct: split.outputPct };
  return { isl: (1 - out) * ctx, osl: out * ctx, cachedShare: split.cachedPct / 100 / (1 - out), reserved: ctx, mix };
}

export function workloadFor(state, model) {
  if (state.shape === 'detailed' && state.detail === 'loop') {
    const a = state.agent;
    const reached = a.c0 + (a.N - 1) * (a.d + a.o) + a.o;
    return { ...calc.agentLoop(a), reserved: Math.min(model.contextMax, reached), mix: null };
  }
  return splitWorkload(state.ctx, state.shape === 'detailed' ? state.split : SIMPLE_SPLIT);
}

// The context length bounds for a model: the floor, and the model's window.
export function ctxBounds(model) {
  return [MIN_CTX, Math.max(MIN_CTX, model.contextMax)];
}
