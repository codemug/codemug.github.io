// The API choice follows the model choice, but only for the like-for-like price:
// when the reader changes the model while a 'ref:' API (the same model on an API)
// is selected, the API becomes that of the new model. A frontier API the reader
// picked is left alone. Pure.

export function followModel(prev, next, data) {
  if (next.modelId === prev.modelId) return next;
  if (!String(prev.apiId).startsWith('ref:') || next.apiId !== prev.apiId) return next;
  const id = 'ref:' + next.modelId;
  return data.apiPrices.some((p) => p.id === id) ? { ...next, apiId: id } : next;
}

// The state a link asks for: the defaults with the link's values on top. A link
// that names a model but no API gets that model's like-for-like API (a link that
// names an API keeps it).
export function linkState(parsed, defaults, data) {
  const merged = { ...defaults, ...parsed };
  return parsed.apiId === undefined ? followModel(defaults, merged, data) : merged;
}
