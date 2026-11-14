#!/usr/bin/env node
// Build public/data/tokenomics/*.json from the seeds in scripts/tokenomics/seeds.
// Usage: node scripts/tokenomics/build-data.mjs [--out DIR]
// A gpus build failure is isolated: the other five files are still written,
// the failure is printed, and the process exits 1. Any other builder failure
// is a hard stop.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildModels } from "./lib/models.mjs";
import { buildGpus, missingValues } from "./lib/gpus.mjs";
import { buildPrices } from "./lib/prices.mjs";
import { buildOffers } from "./lib/offers.mjs";
import { buildBuy } from "./lib/buy.mjs";
import { buildMeta } from "./lib/meta.mjs";

const here = dirname(fileURLToPath(import.meta.url));

function outDirFromArg() {
  const i = process.argv.indexOf("--out");
  if (i === -1) return resolve(here, "..", "..", "public", "data", "tokenomics");
  if (i + 1 >= process.argv.length) throw new Error("--out needs a directory argument");
  return resolve(process.argv[i + 1]);
}

function writeJson(dir, name, data) {
  writeFileSync(join(dir, `${name}.json`), JSON.stringify(data, null, 2) + "\n");
}

function hardFail(message) {
  console.error(`tokenomics build failed: ${message}`);
  process.exit(1);
}

function main() {
  const outDir = outDirFromArg();
  mkdirSync(outDir, { recursive: true });
  let models, prices, offers, buy;
  try {
    models = buildModels();
    prices = buildPrices();
    offers = buildOffers();
    buy = buildBuy();
  } catch (err) {
    hardFail(err.message);
  }
  let gpus = null;
  let gpusError = null;
  try {
    gpus = buildGpus();
  } catch (err) {
    gpusError = err.message;
  }
  const gpusSafe = gpus ?? [];
  const meta = buildMeta(models, gpusSafe, prices, offers, buy);
  writeJson(outDir, "models", models);
  if (!gpusError) writeJson(outDir, "gpus", gpus);
  writeJson(outDir, "api_prices", prices.records);
  writeJson(outDir, "rent_offers", offers.records);
  writeJson(outDir, "buy_options", buy);
  writeJson(outDir, "meta", meta);
  const reasonCount = {};
  for (const f of prices.dropped.filtered) reasonCount[f.reason] = (reasonCount[f.reason] || 0) + 1;
  const lines = [`tokenomics build -> ${outDir}`];
  lines.push(`models.json: ${models.length} rows`);
  lines.push(gpusError ? `gpus.json: FAILED - ${gpusError}` : `gpus.json: ${gpus.length} rows`);
  lines.push(`api_prices.json: ${prices.records.length} rows`);
  lines.push(`rent_offers.json: ${offers.records.length} rows`);
  lines.push(`buy_options.json: ${buy.servers.length} servers`);
  lines.push(`meta.json: generated ${meta.generated}`);
  lines.push(`gpus missingValues: ${JSON.stringify(missingValues(gpusSafe))}`);
  lines.push(
    `api_prices dropped: deprecated ${prices.dropped.deprecated.length}, nullPrice ${prices.dropped.nullPrice.length}, ` +
      `scheduledOnly ${prices.dropped.scheduledOnly.length}, filtered ${prices.dropped.filtered.length} ${JSON.stringify(reasonCount)}`,
  );
  for (const d of prices.dropped.deprecated) lines.push(`  deprecated: ${d.id} (${d.date})`);
  lines.push(`rent_offers dropped: ${JSON.stringify(offers.dropped)}`);
  lines.push(`rent_offers unmapped gpu names: ${offers.unmapped.map(([n, c]) => `${n}=${c}`).join(", ") || "none"}`);
  lines.push("questions:");
  for (const q of [...prices.questions, ...offers.questions]) lines.push(`  - ${q}`);
  console.log(lines.join("\n"));
  process.exitCode = gpusError ? 1 : 0;
}

try {
  main();
} catch (err) {
  hardFail(err.message);
}
