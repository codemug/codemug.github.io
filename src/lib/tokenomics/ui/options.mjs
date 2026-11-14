// Control options for the tokenomics page: api price groups, models, bits,
// rent providers/machines and buy GPUs. Pure functions over the data object.

// The like-for-like group (the same model on an API) comes first and is the
// default; the frontier APIs follow. The frontier models are different, larger
// models, so they compare tokens and not quality.
const GROUPS = [
  ['open_weight_reference', 'Same model on an API (like for like)'],
  ['claude', 'Claude'],
  ['openai', 'OpenAI'],
  ['gemini', 'Gemini'],
];

export function scheduledNote(price) {
  return price.scheduled && price.scheduled.length > 0 ? 'price changes on ' + price.scheduled[0].effective : null;
}

// Groups in the fixed order; items sorted by output price descending, except the
// like-for-like group, which follows the order of the models.
export function apiOptions(data) {
  const groups = [];
  const modelRank = (p) => data.models.findIndex((m) => m.id === p.linkedModelId);
  for (const [key, label] of GROUPS) {
    const items = data.apiPrices
      .filter((p) => p.group === key)
      .sort((a, b) => (key === 'open_weight_reference' ? modelRank(a) - modelRank(b) : b.output - a.output))
      .map((p) => ({ id: p.id, label: key === 'open_weight_reference' ? p.model + ' (' + p.provider + ')' : (p.provider ? p.provider + ' ' : '') + p.model, note: scheduledNote(p) }));
    if (items.length > 0) groups.push({ label, items });
  }
  return groups;
}

// In the author's (data) order.
export function modelOptions(data) {
  return data.models.map((m) => ({ id: m.id, label: m.name, note: null }));
}

// Per-bit entries: enabled needs a checkpoint, estimated mirrors the flag.
export function bitsOptions(model) {
  const out = {};
  for (const bits of [4, 8, 16]) {
    const ck = model.checkpoints[String(bits)];
    const estimated = !!(ck && ck.estimated);
    out[String(bits)] = {
      enabled: !!ck,
      estimated,
      label: bits + ' bits' + (estimated ? ' (estimated)' : ''),
    };
  }
  return out;
}

export function rentProviders(data) {
  return [...new Set(data.rentOffers.map((o) => o.provider))].sort();
}

// Machines of one provider, sorted by GPU type then GPU count then term;
// disabledReason names the GPUs a replica needs when the machine has fewer.
export function rentMachines(data, provider, g) {
  const names = Object.fromEntries(data.gpus.map((gpu) => [gpu.id, gpu.name]));
  return data.rentOffers
    .filter((o) => o.provider === provider)
    .sort((a, b) => a.gpu.localeCompare(b.gpu) || a.gpuCount - b.gpuCount || a.term.localeCompare(b.term))
    .map((o) => ({
      id: o.id,
      label: o.instance + ' - ' + o.gpuCount + (o.gpuCount === 1 ? ' GPU' : ' GPUs') + ' (' + (names[o.gpu] ?? o.gpu) + ', ' + o.term + ')',
      disabledReason: o.gpuCount < g ? 'needs ' + g + ' GPUs per replica' : null,
    }));
}

// The buy GPUs the page offers (those with a buy server), with names.
export function buyGpus(data) {
  const names = Object.fromEntries(data.gpus.map((gpu) => [gpu.id, gpu.name]));
  return ['rtx6000pro', 'b200', 'b300']
    .filter((id) => data.buyOptions.servers.some((sv) => sv.gpu === id))
    .map((id) => ({ id, label: names[id] ?? id }));
}

// Terms of one machine (provider + instance): on demand, 1y, 3y in that
// order, then any other terms in data order.
export function rentTerms(data, provider, instance) {
  const have = new Set(data.rentOffers.filter((o) => o.provider === provider && o.instance === instance).map((o) => o.term));
  const fixed = ['on_demand', '1y', '3y'].filter((t) => have.has(t));
  return fixed.concat([...have].filter((t) => !fixed.includes(t)));
}

// Distinct machines of one provider (one entry per instance), sorted by GPU
// type then GPU count then instance; disabledReason when the machine has
// fewer GPUs than a replica needs.
export function rentMachineOptions(data, provider, g) {
  const names = Object.fromEntries(data.gpus.map((gpu) => [gpu.id, gpu.name]));
  const byInstance = new Map();
  for (const o of data.rentOffers.filter((x) => x.provider === provider)) {
    byInstance.set(o.instance, { instance: o.instance, gpu: o.gpu, gpuCount: o.gpuCount });
  }
  return [...byInstance.values()]
    .sort((a, b) => a.gpu.localeCompare(b.gpu) || a.gpuCount - b.gpuCount || a.instance.localeCompare(b.instance))
    .map((m) => ({
      instance: m.instance,
      label: m.instance + ': ' + m.gpuCount + ' x ' + (names[m.gpu] ?? m.gpu),
      disabledReason: g && m.gpuCount < g ? 'needs ' + g + ' GPUs per replica' : null,
    }));
}

// Offer id for provider + instance + term, or null when that term is not on
// that machine.
export function rentOfferIdFor(data, provider, instance, term) {
  return data.rentOffers.find((o) => o.provider === provider && o.instance === instance && o.term === term)?.id ?? null;
}

// What the workload box shows. Simple: the context length and a one-line note.
// Detailed asks for the shape of each request: the custom split (the context length
// and the percentages) or the agent loop (its own fields).
export function fieldVisibility(state) {
  const detailed = state.shape === 'detailed';
  const loop = detailed && state.detail === 'loop';
  return { detail: detailed, ctx: !loop, hint: !detailed, split: detailed && !loop, loop };
}
