// View model for the tokenomics page: plain strings and arrays for the DOM
// layer to copy into elements. Pure; no HTML is built here.

import { fmtUsd, fmtUsdSmall, fmtInt, fmtPct, fmtShare, fmtStreams, streamsPhrase } from './format.mjs';
import { C_MIN } from './streams.mjs';

const CAPTION_START = 'The straight line is the API cost, the stepped line is self-hosting at its expected throughput (dashed when the speed you asked for is missed), the shaded band is the accuracy band, the dashed vertical line marks the crossover and the solid vertical line is your setting. ';
const RANGE_LOG = 'The horizontal range starts at 0.01 and its right edge follows your parallel streams setting: it is 100, 1,000 or 10,000, the first of these that is at least three times your number (10,000 at most).';
const RANGE_LINEAR = 'The horizontal range runs from 0 to about three times your parallel streams setting, rounded up to a round figure (10,000 at most).';

// The caption for the logarithmic charts (the default) and for the linear ones.
export const CHART_CAPTION = CAPTION_START + RANGE_LOG;
export const LINEAR_CAPTION = CAPTION_START + RANGE_LINEAR;

const TERM_WORDS = { on_demand: 'on demand', '1y': '1-year commitment', '3y': '3-year commitment' };

const streams = streamsPhrase;
const IDLE = " Below that, the GPU would sit partly idle, so the API's pay-per-use is cheaper.";

// "becomes cheaper from about N parallel streams", or, when that is the left edge of the charts, that it is cheaper everywhere.
const becomes = (n) => (n <= C_MIN ? 'is cheaper everywhere on the charts, even at ' + streams(n) : 'becomes cheaper from about ' + streams(n));

// The caption, plus a sentence when the crossover lies beyond the right edge of
// the charts (it is not drawn then).
function chartCaption(result) {
  const base = result.sweep.scale === 'linear' ? LINEAR_CAPTION : CHART_CAPTION;
  const mid = result.crossover.mid;
  if (!result.self.offered || mid === null || mid <= result.sweep.xMax) return base;
  return base + ' The crossover is not drawn because it is off the right edge: self-hosting becomes cheaper from about ' + streams(mid) + '.';
}

function emptyView() {
  return {
    headline: '', crossoverText: '', warning: '',
    api: { title: '', monthly: '', perMtok: '', notes: [] },
    self: { title: '', monthly: '', perMtok: '', deployment: '', perReplica: '', confidence: '', speedMissed: false, notes: [] },
    assumptions: [], chartCaption: CHART_CAPTION,
  };
}

// Scheduled price changes, the record note, and the applied long-context tier.
function apiNotes(price, tierApplied) {
  const notes = [];
  for (const t of price.scheduled ?? []) {
    notes.push('Price changes on ' + t.effective + ' to $' + t.input + ' in and $' + t.output + ' out per million tokens.');
  }
  if (price.note) notes.push(price.note);
  if (tierApplied) notes.push('Long-context price applies above ' + fmtInt(tierApplied.aboveInputTokens) + ' input tokens.');
  return notes;
}

function selfView(result, state, data) {
  const self = result.self;
  const model = data.models.find((m) => m.id === state.modelId) ?? data.models[0];
  const ck = model.checkpoints[String(state.bits)];
  const offer = state.mode === 'rent'
    ? data.rentOffers.find((o) => o.id === state.rentOfferId) ?? data.rentOffers[0]
    : null;
  const gpu = data.gpus.find((g) => g.id === (offer ? offer.gpu : state.buyGpu)) ?? data.gpus[0];
  const notes = [];
  if (ck && ck.estimated) {
    notes.push('No checkpoint at this bit width exists; the size is estimated at ' + ck.bitsPerWeight + ' bits per weight.');
  }
  if (!self.offered) {
    return {
      title: offer ? offer.provider + ' ' + offer.instance : gpu.name + ' (buy)',
      monthly: 'n/a', perMtok: 'n/a',
      deployment: 'Not offered: ' + self.reason, perReplica: '', confidence: '', speedMissed: false,
      notes: [self.reason].concat(notes),
    };
  }
  let deployment;
  if (offer) {
    deployment = self.replicas + (self.replicas === 1 ? ' replica' : ' replicas') + ' of ' + self.g + ' GPU' + (self.g === 1 ? '' : 's') + ' each, on '
      + self.machines + ' machine' + (self.machines === 1 ? '' : 's') + ' (' + offer.gpuCount + ' x ' + gpu.name + ' per machine, ' + offer.instance + '), ' + offer.provider;
  } else {
    // The server evaluate picked for this deployment (serverId), not the smallest.
    const server = data.buyOptions.servers.find((sv) => sv.id === self.serverId)
      ?? data.buyOptions.servers.filter((sv) => sv.gpu === state.buyGpu && sv.gpuCount >= self.g).sort((a, b) => a.gpuCount - b.gpuCount)[0];
    deployment = self.servers + ' server' + (self.servers === 1 ? '' : 's') + ' of ' + server.gpuCount + ' x ' + gpu.name;
  }
  deployment += '; weights: ' + ck.repo + ' (' + ck.sizeGb.toFixed(1) + ' GB)';
  const confidence = (gpu.confidence === 'calibrated' ? 'calibrated on measured runs' : 'extrapolated from other GPUs')
    + ', throughput band x' + gpu.band.low + ' to x' + gpu.band.high;
  return {
    title: self.label,
    monthly: fmtUsd(self.usdPerMonth),
    perMtok: fmtUsdSmall(self.usdPerMtokOut) + ' per million output tokens',
    deployment,
    perReplica: self.meetsSpeed
      ? 'Requests per replica: ' + self.Bv + ' at ' + state.v + ' tokens per second'
      : 'Requests per replica: ' + self.Bv + ' (even one request is slower than ' + state.v + ' tokens per second)',
    confidence,
    speedMissed: self.meetsSpeed === false,
    notes,
  };
}

// The workload rows. Simple fixes the split of the context into cached input, new
// input and output; the custom split of Detailed sets it in the controls; the agent
// loop works it out from the loop. A value says the split in words where there is one.
function workloadRows(state, result) {
  const w = result.workload;
  const mix = w.mix;
  const simple = state.shape === 'simple';
  const setBy = simple ? 'fixed in simple mode' : 'set in the controls';
  const isl = mix ? fmtInt(w.isl) + ' tokens (' + fmtShare(mix.cachedPct) + ' of the context cached, ' + fmtShare(mix.newPct) + ' new)' : fmtInt(w.isl);
  const osl = mix ? fmtInt(w.osl) + ' tokens (' + fmtShare(mix.outputPct) + ' of the context)' : fmtInt(w.osl);
  return [
    { key: 'as.isl', label: 'Input tokens per request', value: isl, basis: mix ? setBy : 'average over the loop' },
    { key: 'as.osl', label: 'Output tokens per request', value: osl, basis: setBy },
    { key: 'as.ctx', label: 'Context reserved per request', value: fmtInt(w.reserved) + ' tokens', basis: mix ? 'reserved in full for every request (worst case)' : 'largest context the loop reaches, capped at the model window' },
    { key: 'as.v', label: 'Speed per stream', value: String(state.v) + ' tokens per second', basis: 'set in the controls' },
    { key: 'as.ttft', label: 'Time to first token', value: String(state.ttftS) + ' seconds', basis: 'set in the controls' },
    { key: 'as.kv', label: 'KV cache precision', value: '8 bits', basis: 'fixed by the model' },
    { key: 'as.hours', label: 'Hours under load per day', value: String(state.hoursPerDay), basis: 'set in the controls' },
    { key: 'as.cached', label: 'Cached input share', value: fmtPct(w.cachedShare), basis: mix ? setBy : 'derived from the agent loop' },
    { key: 'as.cachewrite', label: 'Cache write premium', value: 'not charged', basis: 'not modelled (Anthropic and OpenAI bill 1.25x on tokens written to the cache)' },
  ];
}

function assumptions(state, data, result) {
  const out = workloadRows(state, result);
  if (state.mode === 'rent') {
    const offer = data.rentOffers.find((o) => o.id === state.rentOfferId) ?? data.rentOffers[0];
    out.push(
      { key: 'as.price', label: 'Machine price', value: '$' + (offer.pricePerHour + (offer.addonPerHour ?? 0)).toFixed(2) + ' per hour', basis: 'published' },
      { key: 'as.term', label: 'Billing term', value: TERM_WORDS[offer.term] ?? String(offer.term), basis: 'published' },
    );
  } else {
    const d = data.buyOptions.defaults;
    const basis = (k) => (d.basis && d.basis[k] ? d.basis[k].kind : 'assumption');
    const server = data.buyOptions.servers.find((sv) => sv.id === (result.self.serverId ?? null))
      ?? data.buyOptions.servers.filter((sv) => sv.gpu === state.buyGpu && (result.self.offered ? sv.gpuCount >= result.self.g : true)).sort((a, b) => a.gpuCount - b.gpuCount)[0];
    out.push(
      { key: 'as.amort', label: 'Amortisation years', value: String(d.amortYears) + ' years', basis: basis('amortYears') },
      { key: 'as.energy', label: 'Energy price', value: fmtUsdSmall(d.electricityUsdPerKwh) + ' per kWh', basis: basis('electricityUsdPerKwh') },
      { key: 'as.colo', label: 'Colocation price', value: fmtUsd(d.coloUsdPerKwMonth) + ' per kW per month', basis: basis('coloUsdPerKwMonth') },
      { key: 'as.pue', label: 'Power usage effectiveness', value: String(d.pue), basis: basis('pue') },
      { key: 'as.support', label: 'Support', value: String(d.supportPctPerYear) + ' percent per year', basis: basis('supportPctPerYear') },
      { key: 'as.server', label: 'Server price', value: fmtUsd(server.priceUsd) + ' per server', basis: server.priceKind === 'list' ? 'list price' : server.priceKind === 'retail' ? 'retail price' : 'quote' },
      { key: 'as.power', label: 'Server power', value: server.powerKw.toFixed(2) + ' kW per server', basis: server.powerKind ?? (/\bderived\b/.test(server.note ?? '') ? 'derived' : 'published') },
    );
  }
  return out;
}

// A plain-English warning under the headline when the speed asked for is missed
// even with one request alone on the setup (the figure then gives every stream
// its own replica). Empty otherwise.
function speedWarning(result, state) {
  const s = result.self;
  if (!s.offered || s.meetsSpeed !== false) return '';
  const rounded = Math.round(s.soloTokS);
  const x = rounded >= state.v ? s.soloTokS.toFixed(1) : String(rounded);
  const one = s.g === 1 ? 'One GPU' : 'One replica (' + s.g + ' GPUs)';
  return one + ' reaches only about ' + x + ' tokens per second on these requests, not the ' + state.v + ' you asked for. '
    + 'The self-hosting figure gives every stream its own ' + (s.g === 1 ? 'GPU' : 'replica') + ' and the speed is still missed. Lower the speed per stream or pick a faster GPU.';
}

// A warning when an agent loop reaches more tokens than the model's window. A real agent compacts before that,
// which this calculator does not model, so the average request of the loop is overstated.
function windowWarning(state, data) {
  if (state.shape !== 'detailed' || state.detail !== 'loop') return '';
  const model = data.models.find((m) => m.id === state.modelId);
  const a = state.agent;
  const reached = a.c0 + (a.N - 1) * (a.d + a.o) + a.o;
  if (!model || reached <= model.contextMax) return '';
  return 'This loop reaches ' + fmtInt(reached) + ' tokens, past the ' + fmtInt(model.contextMax) + '-token window of ' + model.name
    + '. Real agents compact before that and the calculator does not model compaction, so the average request is overstated.';
}

export function buildView(result, state, data) {
  if (result.errors.length > 0) {
    const v = emptyView();
    v.headline = result.errors[0];
    return v;
  }
  const apiUsd = result.api.monthly.usdPerMonth;
  let headline;
  if (result.self.offered) {
    const ratio = apiUsd / result.self.usdPerMonth;
    const verdict = Math.abs(ratio - 1) <= 0.05
      ? 'about the same'
      : ratio >= 1 ? ratio.toFixed(1) + ' times cheaper' : (1 / ratio).toFixed(1) + ' times dearer';
    headline = 'At ' + streams(state.C) + ' the API costs ' + fmtUsd(apiUsd)
      + ' a month and self-hosting costs ' + fmtUsd(result.self.usdPerMonth) + ' a month (' + verdict + ').';
  } else {
    headline = 'At ' + streams(state.C) + ' the API costs ' + fmtUsd(apiUsd)
      + ' a month; self-hosting is not offered on this hardware.';
  }
  const { low, mid, high } = result.crossover;
  let crossoverText;
  if (!result.self.offered) crossoverText = 'This model is not offered on this hardware: ' + result.self.reason + '.';
  else if (low === null && mid === null && high === null) crossoverText = 'The API stays cheaper all the way up to 10,000 parallel streams.';
  else if (mid !== null && low === mid && mid === high) {
    crossoverText = 'Self-hosting ' + becomes(mid) + '.' + (mid > C_MIN ? IDLE : '');
  } else if (mid !== null) {
    const fast = low === mid ? 'If the GPUs run faster than expected, that point stays the same' : 'If the GPUs run faster than expected, it happens from ' + fmtStreams(low);
    const slow = high === null ? "if they run slower, it doesn't happen within 10,000 streams." : 'if they run slower, from ' + fmtStreams(high) + '.';
    crossoverText = 'At the expected speed, self-hosting ' + becomes(mid) + '. ' + fast + '; ' + slow + (mid > C_MIN ? IDLE : '');
  } else {
    crossoverText = 'At the expected speed the API stays cheaper all the way up to 10,000 parallel streams. Self-hosting only wins from about '
      + streams(low) + ' if the GPUs run faster than expected.' + IDLE;
  }
  const price = result.api.price;
  return {
    headline,
    crossoverText,
    warning: [speedWarning(result, state), windowWarning(state, data)].filter(Boolean).join(' '),
    api: {
      title: price.model + ' API',
      monthly: fmtUsd(apiUsd),
      perMtok: fmtUsdSmall(result.api.monthly.usdPerMtokOut) + ' per million output tokens',
      notes: apiNotes(price, result.api.tierApplied),
    },
    self: selfView(result, state, data),
    assumptions: assumptions(state, data, result),
    chartCaption: chartCaption(result),
  };
}
