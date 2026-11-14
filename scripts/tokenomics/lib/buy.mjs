// buy_options.json object: servers, defaults, ranges.
// Server rows are the fixed list below; each is matched in seeds/buy_options.json by
// record_type + gpu + gpu_count + system text. Power is parsed from the matching
// "power" row value (leading number and unit). Defaults and ranges are the recommendations below.
import { readSeed, fail } from "./read.mjs";

const DEFAULTS = {
  amortYears: 5,
  residualPct: 0,
  pue: 1.3,
  electricityUsdPerKwh: 0.14,
  coloUsdPerKwMonth: 200,
  coloIncludesEnergy: false,
  supportPctPerYear: 5,
  hoursPerMonth: 730,
};

// R8 part 5 "Slider range" column.
const RANGES = {
  amortYears: { low: 3, high: 6 },
  residualPct: { low: 0, high: 20 },
  electricityUsdPerKwh: { low: 0.07, high: 0.27 },
  coloUsdPerKwMonth: { low: 110, high: 470 },
  pue: { low: 1.1, high: 1.52 },
  supportPctPerYear: { low: 0, high: 12 },
};

// defaults.basis: kind and note come from this table, sourceUrl from the first seed row of record_type.
const BASIS = {
  electricityUsdPerKwh: {
    kind: "published",
    note: "US commercial average 0.1404 USD per kWh (EIA, 2026-01 to 2026-08), rounded to 0.14",
    record_type: "electricity",
  },
  coloUsdPerKwMonth: {
    kind: "aggregator",
    note: "wholesale 250 to 500 kW North America 196 USD per kW per month (QuoteColo, H1 2026), rounded to 200",
    record_type: "colo",
  },
  pue: {
    kind: "recommendation",
    note: "Uptime 2026 survey (n=644): 1.52 industry average, 1.3 or better for new builds; 1.3 chosen",
    record_type: "pue",
  },
  amortYears: {
    kind: "recommendation",
    note: "SEC filings of seven cloud and neocloud operators state 5 to 6 years for servers and network equipment; none states a GPU-only life; 5 chosen",
    record_type: "depreciation",
  },
  residualPct: {
    kind: "recommendation",
    note: "resale evidence is two brokers that disagree (54 to 58 percent against 75 to 85 percent at 24 months for an H100); 0 chosen",
    record_type: "resale",
  },
  supportPctPerYear: {
    kind: "recommendation",
    note: "midpoint between a 3-year onsite add-on of 0.2 percent (Thinkmate) and OEM maintenance contracts of 6 to 12 percent (a reseller blog citing Gartner); there is no published GPU-server figure; 5 chosen",
    record_type: "support",
  },
  hoursPerMonth: { kind: "arithmetic", note: "365 x 24 / 12 = 730", record_type: null },
};

// Contract server rows. seedGpu is the seed gpu field; system must appear in the
// seed system text; powerSystem disambiguates power rows where two exist (B200/B300).
// powerFromPurchase: the 1- and 2-GPU RTX rows carry power_w on the purchase
// row itself (chassis 1,305 W plus 600 W per card, Clarification 5) - no
// separate power row and no 3.705 x n / 4 derivation.
const SERVERS = [
  { id: "rtx6000pro-1", gpu: "rtx6000pro", seedGpu: "RTX PRO 6000 Server", gpuCount: 1, system: "GE95-1202-41", powerFromPurchase: true, powerKind: "derived" },
  { id: "rtx6000pro-2", gpu: "rtx6000pro", seedGpu: "RTX PRO 6000 Server", gpuCount: 2, system: "GE95-1202-41", powerFromPurchase: true, powerKind: "derived" },
  { id: "rtx6000pro-4", gpu: "rtx6000pro", seedGpu: "RTX PRO 6000 Server", gpuCount: 4, system: "GE95-1202-41", powerKind: "derived" },
  { id: "rtx6000pro-8", gpu: "rtx6000pro", seedGpu: "RTX PRO 6000 Server", gpuCount: 8, system: "GXS6-2404-81", powerKind: "measured" },
  { id: "b200-8", gpu: "b200", seedGpu: "B200", gpuCount: 8, system: "DGX B200", powerSystem: "DGX B200", powerKind: "published" },
  { id: "b300-8", gpu: "b300", seedGpu: "B300", gpuCount: 8, system: "DGX B300", powerSystem: "DGX B300", powerKind: "published" },
];

// Exactly one row must match, or the build fails naming the lookup.
function pick(rows, label, pred) {
  const hit = rows.filter(pred);
  if (hit.length !== 1) fail([`buy_options seed: ${label}: expected exactly 1 row, found ${hit.length}`]);
  return hit[0];
}

// Power seed rows hold a numeric value plus a unit string starting with "kW" or "W".
function powerKw(row, label) {
  const unit = String(row.unit ?? "");
  if (typeof row.value !== "number") fail([`buy_options seed: ${label}: value is not a number: ${JSON.stringify(row.value)}`]);
  if (unit.startsWith("kW")) return row.value;
  if (unit.startsWith("W")) return row.value / 1000;
  fail([`buy_options seed: ${label}: unknown unit ${JSON.stringify(unit)}`]);
}

export function buildBuy() {
  const seeds = readSeed("buy_options.json");
  if (!Array.isArray(seeds)) fail(["buy_options.json: expected a JSON array"]);
  const powers = {};
  for (const spec of SERVERS) {
    if (spec.powerFromPurchase) continue;
    const row = pick(
      seeds,
      `power row for ${spec.id}`,
      (r) =>
        r.record_type === "power" &&
        r.gpu_count === spec.gpuCount &&
        String(r.gpu ?? "").toLowerCase() === spec.seedGpu.toLowerCase() &&
        (!spec.powerSystem || String(r.system ?? "").includes(spec.powerSystem)),
    );
    powers[spec.id] = powerKw(row, `power row for ${spec.id}`);
  }
  const servers = SERVERS.map((spec) => {
    const row = pick(
      seeds,
      `purchase row for ${spec.id}`,
      (r) =>
        r.record_type === "purchase" &&
        r.gpu_count === spec.gpuCount &&
        String(r.gpu ?? "").toLowerCase() === spec.seedGpu.toLowerCase() &&
        String(r.system ?? "").includes(spec.system),
    );
    let powerKw;
    let note;
    if (spec.powerFromPurchase) {
      if (typeof row.power_w !== "number") fail([`buy_options seed: purchase row for ${spec.id}: power_w is not a number`]);
      powerKw = row.power_w / 1000;
      note = "derived: chassis 1,305 W plus 600 W per card, from the configurator's component watts";
    } else {
      powerKw = powers[spec.id];
      note = row.notes || null;
    }
    return {
      id: spec.id,
      gpu: spec.gpu,
      gpuCount: spec.gpuCount,
      system: row.system,
      priceUsd: row.price_usd,
      powerKw,
      powerKind: spec.powerKind,
      priceKind: row.price_kind,
      sourceUrl: row.source_url,
      note,
    };
  });
  const basis = {};
  for (const [key, spec] of Object.entries(BASIS)) {
    const row = spec.record_type ? seeds.find((r) => r.record_type === spec.record_type) : null;
    if (spec.record_type && (!row || !row.source_url)) {
      fail([`buy_options seed: no ${spec.record_type} row with source_url for basis.${key}`]);
    }
    basis[key] = { kind: spec.kind, note: spec.note, sourceUrl: row ? row.source_url : null };
  }
  // Keep sources only for the keys whose basis kind is not recommendation.
  const sources = {};
  for (const [key, b] of Object.entries(basis)) {
    if (b.kind !== "recommendation" && b.sourceUrl) sources[key] = b.sourceUrl;
  }
  return { servers, defaults: { ...DEFAULTS, basis, sources }, ranges: RANGES };
}
