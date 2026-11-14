// Sentences for when the page had to change a workload number the reader asked
// for: the context length (above the model's window, or below the floor) and the
// percentages of the custom split. Pure.

import { fmtInt, fmtShare } from './format.mjs';
import { MIN_CTX, MIN_OUTPUT_PCT, MAX_OUTPUT_PCT } from './workload.mjs';

const round1 = (x) => Math.round(x * 10) / 10;
const usesCtx = (state) => state.shape === 'simple' || state.detail === 'split';

// requested is the state before normalizeState, state the normalized one.
// quiet leaves out the "raised" sentences, for a number still being typed.
export function ctxClampNote(requested, state, data, { quiet = false } = {}) {
  if (!usesCtx(state)) return null;
  const want = Math.round(Number(requested.ctx));
  if (!Number.isFinite(want) || want === state.ctx) return null;
  if (want > state.ctx) {
    const model = data.models.find((m) => m.id === state.modelId) ?? data.models[0];
    return 'Context length capped at ' + fmtInt(state.ctx) + ' tokens, the window of ' + model.name + '.';
  }
  return quiet ? null : 'Context length raised to ' + fmtInt(MIN_CTX) + ' tokens, the smallest the calculator allows.';
}

// The custom split of Detailed: output between 0.1% and 99%, cached input between
// 0% and what the output leaves.
export function splitClampNote(requested, state, { quiet = false } = {}) {
  if (state.shape !== 'detailed' || state.detail !== 'split' || !requested.split) return null;
  const out = round1(Number(requested.split.outputPct));
  const cached = round1(Number(requested.split.cachedPct));
  const notes = [];
  if (Number.isFinite(out) && out !== state.split.outputPct) {
    if (out > state.split.outputPct) notes.push('Output capped at ' + fmtShare(MAX_OUTPUT_PCT) + ' of the context.');
    else if (!quiet) notes.push('Output raised to ' + fmtShare(MIN_OUTPUT_PCT) + ' of the context, the smallest the calculator allows.');
  }
  if (Number.isFinite(cached) && cached !== state.split.cachedPct) {
    if (cached > state.split.cachedPct) notes.push('Cached input capped at ' + fmtShare(state.split.cachedPct) + ' of the context, what the output leaves.');
    else if (!quiet) notes.push('Cached input raised to 0% of the context.');
  }
  return notes.length > 0 ? notes.join(' ') : null;
}

// Every sentence about the workload numbers, or null.
export function workloadNote(requested, state, data, opts) {
  return [ctxClampNote(requested, state, data, opts), splitClampNote(requested, state, opts)].filter(Boolean).join(' ') || null;
}
