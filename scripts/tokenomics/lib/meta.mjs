// meta.json: build stamp plus capture provenance for the other five files.
// buy_options.json has no per-record captured field, so its capture date
// comes from the buy_options seed rows.
import { readSeed } from "./read.mjs";

const FILES = ["models", "gpus", "api_prices", "rent_offers", "buy_options"];

function extremes(list) {
  const sorted = [...list].sort();
  return { oldest: sorted[0] ?? null, newest: sorted[sorted.length - 1] ?? null };
}

export function buildMeta(models, gpus, prices, offers, buy) {
  const captures = {
    models: models.map((m) => m.captured),
    gpus: gpus.map((g) => g.captured),
    api_prices: prices.records.map((r) => r.captured),
    rent_offers: offers.records.map((r) => r.captured),
    buy_options: readSeed("buy_options.json").map((r) => r.captured),
  };
  const rows = {
    models: models.length,
    gpus: gpus.length,
    api_prices: prices.records.length,
    rent_offers: offers.records.length,
    buy_options: buy.servers.length,
  };
  const files = {};
  for (const name of FILES) {
    files[name] = { rows: rows[name], oldestCapture: extremes(captures[name]).oldest };
  }
  const all = FILES.flatMap((n) => captures[n]);
  return {
    generated: new Date().toISOString().slice(0, 10),
    oldestCapture: extremes(all).oldest,
    newestCapture: extremes(all).newest,
    files,
  };
}
