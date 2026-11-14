// Data-layer tests for the tokenomics build (lane B1).
// Runs scripts/tokenomics/build-data.mjs into a temp dir via --out and asserts
// the DATA-SHAPES.md contract on the emitted JSON files.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const buildScript = join(repo, "scripts", "tokenomics", "build-data.mjs");
const outDir = mkdtempSync(join(tmpdir(), "tokenomics-data-"));
const report = execFileSync(process.execPath, [buildScript, "--out", outDir], { encoding: "utf8" });

const raw = (name) => readFileSync(join(outDir, `${name}.json`), "utf8");
const read = (name) => JSON.parse(raw(name));
const models = read("models");
const gpus = read("gpus");
const apiPrices = read("api_prices");
const rentOffers = read("rent_offers");
const buy = read("buy_options");
const meta = read("meta");

// True if any object key in the tree starts with the internal prefix aa_.
function hasAaKey(value) {
  if (Array.isArray(value)) return value.some((v) => hasAaKey(v));
  if (value && typeof value === "object") {
    return Object.entries(value).some(([k, v]) => k.startsWith("aa_") || hasAaKey(v));
  }
  return false;
}

// Key-order-insensitive deep equality for the golden fixture comparison.
function deepEq(a, b) {
  if (a === b) return true;
  if (a == null || b == null || typeof a !== "object" || typeof b !== "object") return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => kb.includes(k) && deepEq(a[k], b[k]));
}

test("build exits 0 and writes all six files", () => {
  for (const name of ["models", "gpus", "api_prices", "rent_offers", "buy_options", "meta"]) {
    assert.ok(existsSync(join(outDir, `${name}.json`)), `missing ${name}.json`);
  }
  assert.match(report, /exit 0|tokenomics build ->/);
});

test("models.json: the seven contract ids with 4/8/16-bit checkpoints", () => {
  assert.deepEqual(
    models.map((m) => m.id),
    ["qwen3.8-27b", "qwen3.8-flash-next", "kimi-k3.1-pro", "deepseek-v4.1-flash", "muse-spark-open", "nemotron-3.5-super-vl", "gemma-4-31b"],
  );
  for (const m of models) {
    assert.deepEqual(Object.keys(m.checkpoints).sort(), ["16", "4", "8"], `model ${m.id} checkpoint keys`);
  }
});

test("api_prices: the three claude ids and the seven expected reference prices", () => {
  assert.deepEqual(
    apiPrices.filter((r) => r.group === "claude").map((r) => r.id).sort(),
    ["Anthropic:claude-fable-5-1", "Anthropic:claude-opus-5-5", "Anthropic:claude-sonnet-5-5"],
  );
  const expected = {
    "ref:qwen3.8-27b": [0.5, 0.1, 3.0],
    "ref:qwen3.8-flash-next": [0.15, 0.016, 0.47],
    "ref:kimi-k3.1-pro": [2.0, 0.2, 10.0],
    "ref:deepseek-v4.1-flash": [0.3, 0.006, 1.2],
    "ref:muse-spark-open": [1.25, 0.15, 4.25],
    "ref:nemotron-3.5-super-vl": [0.15, 0.02, 0.5],
    "ref:gemma-4-31b": [0.15, 0.06, 0.4],
  };
  for (const [id, [input, cached, output]] of Object.entries(expected)) {
    const r = apiPrices.find((x) => x.id === id);
    assert.ok(r, `missing reference record ${id}`);
    assert.equal(r.group, "open_weight_reference", `${id} group`);
    assert.ok(r.linkedModelId, `${id} linkedModelId`);
    assert.equal(r.input, input, `${id} input`);
    assert.equal(r.cachedInput, cached, `${id} cachedInput`);
    assert.equal(r.output, output, `${id} output`);
  }
});

test("gpus.json matches the golden fixtures field for field", () => {
  const golden = JSON.parse(readFileSync(join(repo, "tests", "fixtures", "tokenomics", "fixtures.json"), "utf8"));
  assert.equal(gpus.length, golden.gpus.length, "gpu count");
  for (const g of gpus) {
    const want = golden.gpus.find((x) => x.id === g.id);
    assert.ok(want, `missing golden gpu ${g.id}`);
    // The golden holds the contract fields; the output may add provenance
    // fields (tdpW, sourceUrl, captured) accepted in an earlier step.
    for (const k of Object.keys(want)) {
      assert.ok(k in g, `gpu ${g.id} missing golden field ${k}`);
      assert.ok(deepEq(g[k], want[k]), `gpu ${g.id} field ${k} differs: ${JSON.stringify(g[k])} !== ${JSON.stringify(want[k])}`);
    }
  }
});

test("buy_options: the 1- and 2-GPU RTX PRO 6000 power comes from the purchase rows", () => {
  const byId = (id) => buy.servers.find((s) => s.id === id);
  const note = "derived: chassis 1,305 W plus 600 W per card, from the configurator's component watts";
  assert.equal(byId("rtx6000pro-1").powerKw, 1.905);
  assert.equal(byId("rtx6000pro-2").powerKw, 2.505);
  assert.equal(byId("rtx6000pro-1").note, note);
  assert.equal(byId("rtx6000pro-2").note, note);
  assert.equal(byId("rtx6000pro-4").powerKw, 3.705);
  assert.equal(byId("rtx6000pro-8").powerKw, 6.5);
  const kinds = new Set(["derived", "measured", "published"]);
  for (const s of buy.servers) assert.ok(kinds.has(s.powerKind), `server ${s.id} powerKind ${s.powerKind}`);
});

test("every record carries a source and a capture date", () => {
  for (const m of models) {
    assert.ok(Array.isArray(m.sourceUrls) && m.sourceUrls.length, `model ${m.id} sourceUrls`);
    assert.match(m.captured, /^\d{4}-\d{2}-\d{2}$/, `model ${m.id} captured`);
  }
  for (const g of gpus) {
    assert.ok(g.sourceUrl, `gpu ${g.id} sourceUrl`);
    assert.match(g.captured, /^\d{4}-\d{2}-\d{2}$/, `gpu ${g.id} captured`);
  }
  for (const r of [...apiPrices, ...rentOffers]) {
    assert.ok(r.sourceUrl, `${r.id} sourceUrl`);
    assert.ok(r.sourceKind, `${r.id} sourceKind`);
    assert.match(r.captured, /^\d{4}-\d{2}-\d{2}$/, `${r.id} captured`);
  }
});

test("no aa_ keys and no dash or curly-quote characters in any output file", () => {
  for (const name of ["models", "gpus", "api_prices", "rent_offers", "buy_options", "meta"]) {
    assert.ok(!hasAaKey(read(name)), `${name}.json contains an aa_ key`);
    assert.ok(!/[\u2013\u2014\u2018\u2019\u201c\u201d]/.test(raw(name)), `${name}.json contains a dash or curly-quote character`);
  }
});

test("price bounds are sane", () => {
  for (const r of apiPrices) {
    assert.ok(r.input > 0 && r.input < 100, `${r.id} input out of bounds: ${r.input}`);
    assert.ok(r.output > 0 && r.output < 1000, `${r.id} output out of bounds: ${r.output}`);
    assert.ok(r.cachedInput == null || (r.cachedInput >= 0 && r.cachedInput <= r.input), `${r.id} cachedInput`);
    for (const t of r.tiers) {
      assert.ok(t.aboveInputTokens > 0 && t.input > 0 && t.output > 0, `${r.id} tier`);
    }
  }
  for (const r of rentOffers) {
    assert.ok(r.pricePerHour > 0, `${r.id} pricePerHour`);
    assert.ok(r.gpuCount >= 1, `${r.id} gpuCount`);
  }
  for (const s of buy.servers) {
    assert.ok(s.priceUsd > 0 && s.powerKw > 0, `server ${s.id}`);
  }
});

test("every rent_offers and buy_options gpu resolves to a gpus.json id", () => {
  const ids = new Set(gpus.map((g) => g.id));
  assert.equal(ids.size, 9);
  for (const r of rentOffers) assert.ok(ids.has(r.gpu), `${r.id} gpu ${r.gpu} not in gpus.json`);
  for (const s of buy.servers) assert.ok(ids.has(s.gpu), `server ${s.id} gpu ${s.gpu} not in gpus.json`);
});

test("meta.json row counts match the emitted files", () => {
  assert.equal(meta.files.models.rows, models.length);
  assert.equal(meta.files.gpus.rows, gpus.length);
  assert.equal(meta.files.api_prices.rows, apiPrices.length);
  assert.equal(meta.files.rent_offers.rows, rentOffers.length);
  assert.equal(meta.files.buy_options.rows, buy.servers.length);
  assert.match(meta.generated, /^\d{4}-\d{2}-\d{2}$/);
});
