// A sentence for when the page had to change the context length the reader
// asked for (Simple mode): above the model's window, or below the floor. Pure.

import { fmtInt } from './format.mjs';
import { MIN_CTX } from './workload.mjs';

// requested is the state before normalizeState, state the normalized one.
// quiet leaves out the "raised" sentence, for a number still being typed.
export function ctxClampNote(requested, state, data, { quiet = false } = {}) {
  if (state.shape !== 'simple') return null;
  const want = Math.round(Number(requested.ctx));
  if (!Number.isFinite(want) || want === state.ctx) return null;
  if (want > state.ctx) {
    const model = data.models.find((m) => m.id === state.modelId) ?? data.models[0];
    return 'Context length capped at ' + fmtInt(state.ctx) + ' tokens, the window of ' + model.name + '.';
  }
  return quiet ? null : 'Context length raised to ' + fmtInt(MIN_CTX) + ' tokens, the smallest the calculator allows.';
}
