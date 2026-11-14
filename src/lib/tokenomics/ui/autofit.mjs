// Keeps the self-hosting choice able to hold the chosen model. After a change of
// model, bits per weight or context window, the rented machine (or the bought
// GPU) can be too small, and self-hosting would drop out of the charts. fitState
// moves to the nearest choice that fits and says so. Pure; never throws; the
// result fits or is the state it was given, so a second call changes nothing.

import * as calc from '../calc.mjs';
import { rentTerms, buyGpus } from './options.mjs';
import { workloadFor } from './workload.mjs';

const BUY_ORDER = ['rtx6000pro', 'b200', 'b300'];

const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);
const price = (o) => o.pricePerHour + (o.addonPerHour ?? 0);

// The memory the sizing reserves for each request: the reserved context, never
// less than the request's own length (the same rule as the step model).
function reserveOf(workload) {
  return Math.max(workload.reserved, Math.round(workload.isl + workload.osl));
}

function gpusNeeded(model, state, gpu, workload) {
  return calc.minGpus(model, state.bits, gpu, reserveOf(workload));
}

// The cheapest machine of this provider and GPU type with at least g GPUs, as
// its offer on the wanted term (else on demand, else the first term it has).
function sameGpuOffer(data, offer, g) {
  const sized = data.rentOffers.filter((o) => o.provider === offer.provider && o.gpu === offer.gpu && o.gpuCount >= g);
  if (sized.length === 0) return null;
  const count = Math.min(...sized.map((o) => o.gpuCount));
  const instances = [...new Set(sized.filter((o) => o.gpuCount === count).map((o) => o.instance))];
  const cheapest = (inst) => Math.min(...sized.filter((o) => o.instance === inst).map(price));
  const instance = instances.sort((a, b) => cheapest(a) - cheapest(b) || a.localeCompare(b))[0];
  const terms = rentTerms(data, offer.provider, instance);
  const term = terms.includes(offer.term) ? offer.term : terms[0];
  return sized.find((o) => o.instance === instance && o.term === term);
}

// When the provider has no big enough machine of that GPU type: its cheapest
// machine, on the wanted term when possible, whose own GPU type holds the model.
function otherGpuOffer(data, state, model, offer, workload) {
  const fits = data.rentOffers.filter((o) => {
    if (o.provider !== offer.provider) return false;
    const g = gpusNeeded(model, state, data.gpus.find((x) => x.id === o.gpu), workload);
    return g !== null && o.gpuCount >= g;
  });
  const pool = [offer.term, 'on_demand'].map((t) => fits.filter((o) => o.term === t)).find((p) => p.length > 0) ?? fits;
  return pool.sort((a, b) => price(a) - price(b) || a.gpuCount - b.gpuCount || a.id.localeCompare(b.id))[0] ?? null;
}

function fitRent(state, data, model, workload) {
  const offer = data.rentOffers.find((o) => o.id === state.rentOfferId);
  if (!offer) return null;
  const gpu = data.gpus.find((x) => x.id === offer.gpu);
  const g = gpusNeeded(model, state, gpu, workload);
  if (g !== null && offer.gpuCount >= g) return null;
  const same = g === null ? null : sameGpuOffer(data, offer, g);
  const pick = same ?? otherGpuOffer(data, state, model, offer, workload);
  if (!pick) return null;
  const what = model.name + ' at ' + state.bits + ' bits';
  const why = same ? what + ' needs ' + plural(g, 'GPU', 'GPUs') + ' per replica' : what + ' does not fit on ' + gpu.name;
  return {
    state: { ...state, rentOfferId: pick.id },
    note: 'Switched to ' + pick.instance + ' (' + plural(pick.gpuCount, 'GPU', 'GPUs') + ') because ' + why + '.',
  };
}

// Is the model offered on this GPU: one replica fits and a server of this GPU is on sale.
function buyOffered(state, data, model, workload, gpuId) {
  const gpu = data.gpus.find((x) => x.id === gpuId);
  const dep = calc.sizeDeployment({
    model, bits: state.bits, gpu, C: state.C, isl: workload.isl, osl: workload.osl, v: state.v,
    cachedShare: workload.cachedShare, ctx: workload.reserved, mtp: false, tf: 1,
  });
  return dep.offered && data.buyOptions.servers.some((sv) => sv.gpu === gpuId && sv.gpuCount >= dep.g);
}

function fitBuy(state, data, model, workload) {
  if (buyOffered(state, data, model, workload, state.buyGpu)) return null;
  const onSale = new Set(buyGpus(data).map((g) => g.id));
  const next = BUY_ORDER.slice(BUY_ORDER.indexOf(state.buyGpu) + 1).filter((id) => onSale.has(id));
  const pick = next.find((id) => buyOffered(state, data, model, workload, id));
  if (!pick) return null;
  const name = (id) => data.gpus.find((x) => x.id === id).name;
  return {
    state: { ...state, buyGpu: pick },
    note: 'Switched to ' + name(pick) + ' servers because ' + model.name + ' at ' + state.bits + ' bits does not fit on ' + name(state.buyGpu) + ' servers.',
  };
}

// { state, note }: the state moved to a choice that fits, with a sentence that
// says what changed; or the same state object and a null note.
export function fitState(state, data) {
  try {
    const model = data.models.find((m) => m.id === state.modelId) ?? data.models[0];
    const workload = workloadFor(state, model);
    const fit = state.mode === 'buy' ? fitBuy(state, data, model, workload) : fitRent(state, data, model, workload);
    return fit ?? { state, note: null };
  } catch {
    return { state, note: null };
  }
}
