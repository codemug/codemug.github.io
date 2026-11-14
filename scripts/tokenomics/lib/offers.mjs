// rent_offers.json from seeds/offers_r4.json and seeds/offers_r9.json.
// offers_r9.json supersedes offers_r4.json where it corrects it (Crusoe and Together per-GPU rows become
// 8-GPU machine rows).
import { readSeed, fail } from "./read.mjs";

// Seed gpu name -> gpus.json id. Names not listed are dropped and reported.
const GPU_MAP = {
  "RTX PRO 6000 Blackwell Server": "rtx6000pro",
  "RTX PRO 6000 Blackwell Server (high mem)": "rtx6000pro",
  "RTX PRO 6000 Blackwell": "rtx6000pro",
  "NVIDIA RTX PRO 6000": "rtx6000pro",
  "RTX PRO 6000": "rtx6000pro",
  L40S: "l40s",
  "L40S (Intel CPU)": "l40s",
  "L40S (AMD CPU)": "l40s",
  "NVIDIA_L40S": "l40s",
  "H100 SXM": "h100",
  "Nvidia H100": "h100",
  "NVIDIA_H100": "h100",
  H200: "h200",
  "Nvidia H200": "h200",
  B200: "b200",
  "Nvidia B200": "b200",
  "NVIDIA_B200": "b200",
  B300: "b300",
  GB200: "gb200",
  MI300X: "mi300x",
  AMD_MI300X: "mi300x",
  MI355X: "mi355x",
  AMD_MI355X: "mi355x",
};

const KEEP_PROVIDERS = new Set([
  "AWS", "GCP", "Azure", "Oracle OCI", "CoreWeave", "Nebius", "Lambda",
  "Crusoe", "Together AI", "RunPod (Secure Cloud)", "Modal",
]);

// on_demand / 1y / 3y only. committed is dropped: no seed row states a
// 1-year or 3-year term (Together: "91-180 days", Lambda: "2 weeks - 1 year").
const TERM_MAP = { on_demand: "on_demand", savings_plan_1y: "1y", reserved_1y: "1y", savings_plan_3y: "3y", reserved_3y: "3y" };

// R9's machine rows are the correction to R4's per-GPU listings.
const R9_SUPERSEDES_R4 = new Set(["Crusoe", "Together AI"]);

// Region values that are not US (or not the default US region of the provider).
const NON_US = new Set([
  "us-east-2", "us-west-2", "us-east1", "us-east5", "US East (Dallas) Local Zone",
  "eu-central-1", "eu-north-1", "ap-northeast-1", "europe-west2", "europe-west4",
  "eu-north1", "eu-iceland1-a", "eu-iceland1-a and others",
]);

const DEFAULT_REGION = { AWS: "us-east-1", GCP: "us-central1", Azure: "eastus" };

function normRegion(region) {
  return (region || "").replace(" (page default)", "");
}

function regionOk(provider, region) {
  const def = DEFAULT_REGION[provider];
  if (def) return provider === "Azure" ? !NON_US.has(region) : region === def;
  return !NON_US.has(region);
}

// Trim a note; an empty note becomes null.
function sanitize(note) {
  const clean = (note || "").trim();
  return clean || null;
}

function buildOffers() {
  const r4 = readSeed("offers_r4.json");
  const r9 = readSeed("offers_r9.json");
  if (!Array.isArray(r4) || !Array.isArray(r9)) fail(["offers_r4.json / offers_r9.json: expected JSON arrays"]);
  const unmapped = new Map();
  for (const r of [...r4, ...r9]) if (!GPU_MAP[r.gpu]) unmapped.set(r.gpu, (unmapped.get(r.gpu) || 0) + 1);
  const r9GpuByProvider = new Map();
  for (const r of r9) if (KEEP_PROVIDERS.has(r.provider) && GPU_MAP[r.gpu]) {
    const s = r9GpuByProvider.get(r.provider) ?? new Set();
    s.add(r.gpu);
    r9GpuByProvider.set(r.provider, s);
  }
  const dropped = { provider: 0, term: 0, unmappedGpu: 0, superseded: 0, region: 0, futurePrice: 0, nullPrice: 0, duplicate: 0 };
  const FUTURE_RE = /^(New price from \d{4}-\d{2}-\d{2})|(^New on-demand price per GPU-hour starting)/i;
  const groups = new Map();
  for (const [src, rows] of [["r4", r4], ["r9", r9]]) {
    for (const row of rows) {
      if (!KEEP_PROVIDERS.has(row.provider)) { dropped.provider++; continue; }
      const term = TERM_MAP[row.pricing_model];
      if (!term) { dropped.term++; continue; }
      const gpu = GPU_MAP[row.gpu];
      if (!gpu) { dropped.unmappedGpu++; continue; }
      if (src === "r4" && R9_SUPERSEDES_R4.has(row.provider) && (r9GpuByProvider.get(row.provider) ?? new Set()).has(row.gpu)) {
        dropped.superseded++;
        continue;
      }
      const region = normRegion(row.region);
      if (!regionOk(row.provider, region)) { dropped.region++; continue; }
      if (FUTURE_RE.test(row.notes || "")) { dropped.futurePrice++; continue; }
      if (row.price_per_hour == null) { dropped.nullPrice++; continue; }
      const key = `${row.provider}|${row.instance}|${term}`;
      const g = groups.get(key) ?? [];
      g.push({ src, row, term, gpu, region });
      groups.set(key, g);
    }
  }
  const records = [];
  for (const group of groups.values()) {
    // R9 rows win on a shared key (R9 is the correction).
    const fromR9 = group.filter((c) => c.src === "r9");
    const base = fromR9.length ? fromR9 : group;
    const def = DEFAULT_REGION[base[0].row.provider];
    const inDefault = def ? base.filter((c) => c.region === def) : [];
    const pool = inDefault.length ? inDefault : base;
    pool.sort((a, b) => a.row.price_per_hour - b.row.price_per_hour || a.region.localeCompare(b.region));
    const pick = pool[0];
    dropped.duplicate += group.length - 1;
    const id = `${pick.row.provider}:${pick.row.instance}:${pick.term}`;
    records.push({
      id,
      provider: pick.row.provider,
      instance: pick.row.instance,
      gpu: pick.gpu,
      gpuCount: pick.row.gpu_count,
      term: pick.term,
      pricePerHour: pick.row.price_per_hour,
      addonPerHour: null,
      region: pick.region || null,
      sourceUrl: pick.row.source_url,
      sourceKind: pick.row.source_kind,
      captured: pick.row.captured,
      note: sanitize(pick.row.notes),
    });
  }
  const seen = new Set();
  for (const r of records) if (!seen.add(r.id)) fail([`duplicate offer id ${r.id}`]);
  records.sort((a, b) => a.id.localeCompare(b.id));
  const questions = [
    "Azure: the seed has no eastus row for some machines (H200 v5, MI300X v5); where the default region is absent the cheapest US-region row is kept per machine and term, and region shows that actual region.",
    "Lambda 1-Click Cluster committed rows state a term of '2 weeks - 1 year', not a stated 1-year term, so they are dropped; say the word if they should be emitted as term 1y.",
    "Nebius R4 rows carry no region in the seed; they are kept with the seed region string ('not stated') - flag if they should be dropped.",
    "Modal addonPerHour is null: the R9 notes give CPU and memory rates and a container minimum but no default container size.",
    "AWS lists the same instance/term under both Compute and EC2 Instance Savings Plan; the cheaper (Instance SP) price is kept.",
    "Crusoe has no current-price row in a US region for B300 and H200 (eu-iceland1-a only), and no current B200 price (contact sales); no Crusoe rows for those GPUs.",
  ];
  return { records, dropped, unmapped: [...unmapped.entries()], questions };
}

export { buildOffers };
