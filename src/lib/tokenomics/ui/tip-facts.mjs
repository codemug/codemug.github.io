// The run-time numbers behind the {name} slots in tips.mjs. Pure: every value
// is read from the data, the page state or the evaluation result.

import { fmtInt, fmtPct, fmtStreams, streamsPhrase } from './format.mjs';
import { C_MIN } from './streams.mjs';
import { TIPS } from './tips.mjs';

const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);
const streams = streamsPhrase;

// One sentence about the model file at one bit width.
function bitsLine(model, bits) {
  const ck = model.checkpoints[String(bits)];
  if (!ck) return 'No file at this size is listed for ' + model.name + '.';
  let line = model.name + ' at ' + bits + ' bits is a ' + ck.sizeGb.toFixed(1) + ' GB file' + (ck.repo ? ' (' + ck.repo + ')' : '') + '.';
  if (ck.estimated) line += ' No ready-made file exists, so the size is estimated at ' + ck.bitsPerWeight + ' bits per weight.';
  return line;
}

function apiFacts(price) {
  const cached = price.cachedInput == null
    ? 'This API has no cached price, so the page charges the full input price.'
    : 'On ' + price.model + ' a cached token costs $' + price.cachedInput + ' per million, against $' + price.input + ' for a new one.';
  const name = price.model + (price.provider ? ' (' + price.provider + ')' : '');
  return {
    apiCachedNow: cached,
    apiNow: 'Selected: ' + name + ', $' + price.input + ' per million input tokens'
      + (price.cachedInput == null ? '' : ' ($' + price.cachedInput + ' if cached)') + ' and $' + price.output + ' per million output tokens.',
  };
}

function crossNow(result) {
  const { low, mid } = result.crossover;
  if (!result.self.offered) return 'Self-hosting is not offered here, so there is none.';
  if (mid !== null && mid <= C_MIN) return 'Here self-hosting is cheaper everywhere on the charts, even at ' + streams(mid) + '.';
  if (mid !== null && mid > result.sweep.xMax) return 'Here it is about ' + streams(mid) + ', off the right edge of the charts, so it is not drawn.';
  if (mid !== null) return 'Here it is about ' + streams(mid) + '.';
  if (low !== null) return 'Here the API stays cheaper at the expected speed. Self-hosting wins from about ' + streams(low) + ' only if the GPUs run at the fast end.';
  return 'Here there is none between 0.01 and 10,000 parallel streams.';
}

// What the self-hosting card says it runs, and how the monthly figure is built.
function selfFacts(state, data, result, offer) {
  const self = result.self;
  const rent = state.mode === 'rent';
  const d = data.buyOptions.defaults;
  const word = rent ? 'machine' : 'server';
  const units = self.offered ? (rent ? self.machines : self.servers) : null;
  let monthlyHow = 'servers x (the server price spread over ' + d.amortYears + ' years + electricity + rack space + support), for all 24 hours a day';
  if (rent) {
    monthlyHow = self.offered
      ? plural(self.machines, 'machine', 'machines') + ' x $' + (self.usdPerHour / self.machines).toFixed(2) + ' an hour x ' + state.hoursPerDay + ' hours a day x 30.4 days'
      : 'machines x price per hour x ' + state.hoursPerDay + ' hours a day x 30.4 days';
  }
  return {
    deployNow: self.offered
      ? plural(self.replicas, 'replica', 'replicas') + ' of ' + plural(self.g, 'GPU', 'GPUs') + ' each, on ' + plural(units, word, word + 's')
      : 'nothing, because this combination is not offered',
    monthlyHow,
    buyNow: !rent && self.offered ? 'Cheapest fit right now: ' + plural(self.servers, 'server', 'servers') + ' of ' + self.label + '.' : '',
    machineNow: offer
      ? offer.instance + ': ' + offer.gpuCount + ' x ' + (data.gpus.find((g) => g.id === offer.gpu)?.name ?? offer.gpu) + ' at $' + (offer.pricePerHour + (offer.addonPerHour ?? 0)).toFixed(2) + ' an hour.'
      : '',
    termNow: TIPS['term.' + (offer ? offer.term : 'on_demand')] ?? '',
    bv: self.offered ? self.Bv : 'n/a',
    maxSpeedNote: self.offered
      ? 'On this setup one request alone reaches about ' + Math.round(self.soloTokS) + ' tokens per second, so asking for more than that cannot be met by '
        + (self.g === 1 ? 'one GPU' : 'one replica of ' + self.g + ' GPUs') + '.'
      : '',
  };
}

export function buildFacts(state, data, result) {
  const w = result.workload;
  const model = data.models.find((m) => m.id === state.modelId) ?? data.models[0];
  const offer = state.mode === 'rent' ? data.rentOffers.find((o) => o.id === state.rentOfferId) ?? data.rentOffers[0] : null;
  const gpu = data.gpus.find((g) => g.id === (offer ? offer.gpu : state.buyGpu)) ?? data.gpus[0];
  const d = data.buyOptions.defaults;
  const sf = selfFacts(state, data, result, offer);
  const reserve = Math.max(w.reserved, Math.round(w.isl + w.osl));
  const experts = model.E > 1 ? ' It is a mixture of experts: only ' + model.k + ' of its ' + model.E + ' experts per layer work on each token.' : '';
  return {
    ...apiFacts(result.api.price),
    ...sf,
    captured: data.meta && data.meta.oldestCapture ? data.meta.oldestCapture : 'an unknown date',
    C: fmtStreams(state.C),
    xMax: fmtInt(result.sweep.xMax),
    isl: fmtInt(w.isl),
    osl: fmtInt(w.osl),
    cachedPct: fmtPct(w.cachedShare),
    v: String(state.v),
    hours: String(state.hoursPerDay),
    ttft: String(state.ttftS),
    reqPerHour: fmtStreams(result.api.monthly.requestsPerHour),
    reqSeconds: (w.osl / state.v + state.ttftS).toFixed(1),
    modelNow: model.name + ' reads up to ' + fmtInt(model.contextMax) + ' tokens at once.' + experts,
    bitsNow: bitsLine(model, state.bits),
    bits4: bitsLine(model, 4),
    bits8: bitsLine(model, 8),
    bits16: bitsLine(model, 16),
    ctxNow: result.self.offered
      ? 'At ' + fmtInt(reserve) + ' tokens, one replica holds ' + plural(result.self.Bv, 'request', 'requests') + ' at once.'
      : '',
    gpuNow: gpu.name + ': ' + gpu.memGb + ' GB of memory per GPU.',
    bandLow: String(gpu.band.low),
    bandHigh: String(gpu.band.high),
    crossNow: crossNow(result),
    amortYears: String(d.amortYears),
    pue: String(d.pue),
    support: String(d.supportPctPerYear),
  };
}
