// Fetch the tokenomics data files in parallel. Throws an Error naming the
// failing file so the page can show a plain message instead of a blank box.

const FILES = {
  models: 'models.json',
  gpus: 'gpus.json',
  apiPrices: 'api_prices.json',
  rentOffers: 'rent_offers.json',
  buyOptions: 'buy_options.json',
  meta: 'meta.json',
};

const ARRAY_KEYS = ['models', 'gpus', 'apiPrices', 'rentOffers'];

export async function loadData(baseUrl) {
  const out = {};
  await Promise.all(Object.entries(FILES).map(async ([key, file]) => {
    const res = await fetch(baseUrl + file);
    if (!res.ok) throw new Error(file + ' could not be loaded (HTTP ' + res.status + ')');
    const body = await res.json();
    const wantArray = ARRAY_KEYS.includes(key);
    const okType = wantArray ? Array.isArray(body) : body !== null && typeof body === 'object';
    if (!okType) throw new Error(file + ' is not a ' + (wantArray ? 'array' : 'object'));
    out[key] = body;
  }));
  return {
    models: out.models,
    gpus: out.gpus,
    apiPrices: out.apiPrices,
    rentOffers: out.rentOffers,
    buyOptions: out.buyOptions,
    meta: out.meta,
  };
}
