// The workload a page state describes, in the form the cost and sizing code
// takes: the request's input and output tokens, the cached share and the
// context reserved for every request. Pure.
//
// Simple: every request holds `ctx` tokens in total, 1,000 of them output, the
// rest input, nothing cached; the same `ctx` is the memory reserved per request.
// Detailed: an agent loop. The request is the average turn of the loop; the
// memory reserved is the largest context the loop reaches, capped at the model's
// window.

import * as calc from '../calc.mjs';

export const SIMPLE_OSL = 1000;
export const MIN_CTX = 2000;

export function workloadFor(state, model) {
  if (state.shape === 'detailed') {
    const a = state.agent;
    const reached = a.c0 + (a.N - 1) * (a.d + a.o) + a.o;
    return { ...calc.agentLoop(a), reserved: Math.min(model.contextMax, reached) };
  }
  return { isl: state.ctx - SIMPLE_OSL, osl: SIMPLE_OSL, cachedShare: 0, reserved: state.ctx };
}

// The context length bounds for a model: the floor, and the model's window.
export function ctxBounds(model) {
  return [MIN_CTX, Math.max(MIN_CTX, model.contextMax)];
}
