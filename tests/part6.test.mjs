// Part 6 post gates: style contract, section order, calculator placement, figures that exist, and the
// numbers the prose quotes from the data and the calculator. Run: node --test tests/part6.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { evaluate } from "../src/lib/tokenomics/ui/evaluate.mjs";
import { stepModel, minGpus } from "../src/lib/tokenomics/calc.mjs";
import { normalizeState, DEFAULT_STATE } from "../src/lib/tokenomics/ui/state.mjs";
import { buildView } from "../src/lib/tokenomics/ui/view.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const post = readFileSync(join(here, "../src/content/blog/sre-guide-deploying-llms-part-6.mdx"), "utf8");
const dataDir = join(here, "../public/data/tokenomics/");
const rd = (f) => JSON.parse(readFileSync(join(dataDir, f), "utf8"));
const data = { models: rd("models.json"), gpus: rd("gpus.json"), apiPrices: rd("api_prices.json"), rentOffers: rd("rent_offers.json"), buyOptions: rd("buy_options.json"), meta: rd("meta.json") };

const [, front, body] = post.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
const proseOnly = body.replace(/```[\s\S]*?```/g, "");
const SECTIONS = 4;
const HOURS_PER_MONTH = 24 * 30.4; // the calculator's month

test("frontmatter: part 6 title, draft until published, schema fields present", () => {
  assert.match(front, /^title: ".*Part 6: tokenomics"$/m);
  for (const k of ["description", "pubDate", "tags"]) assert.match(front, new RegExp("^" + k + ":", "m"));
  assert.match(front, /^draft: (true|false)$/m);
});

test("style: no em dashes, en dashes or curly quotes anywhere in the post", () => {
  assert.equal(/[–—‘’“”]/.test(post), false);
});

test("style: no proof-of-checking phrasing and no roadmap filler", () => {
  for (const re of [/\bsurveyed\b/i, /\bwe (checked|found|measured)\b/i, /\bat the time of this writing\b/i, /\bno provider\b/i, /^We start with the API side/m, /^Let's start with the side most of us/m]) {
    assert.equal(re.test(proseOnly), false, "rejected phrasing " + re);
  }
});

test("public safety: no internal names, ticket ids, lane names or Artificial Analysis data", () => {
  for (const re of [/careem/i, /\bproxy\b/i, /\bOrigin header/i, /\bIE-\d+/, /\bR(4|8|9|10)\b/, /artificial analysis/i, /\baa_/i, /\bas of 20\d\d/i]) {
    assert.equal(re.test(post), false, "forbidden pattern " + re);
  }
});

test("structure: four numbered H2 sections in order, exactly one calculator, inside section 4", () => {
  const h2 = [...body.matchAll(/^## (\d+)\. (.+)$/gm)].map((m) => Number(m[1]));
  assert.deepEqual(h2, [1, 2, 3, 4]);
  assert.equal((post.match(/<Calculator \/>/g) || []).length, 1);
  assert.equal((post.match(/import Calculator from/g) || []).length, 1);
  assert.ok(body.indexOf("<Calculator />") > body.indexOf("## 4. "));
});

test("cross-references: every 'section N' names a section that exists", () => {
  for (const m of proseOnly.matchAll(/[Ss]ections? (\d+)(?: (?:and|to) (\d+))?/g)) {
    for (const n of [m[1], m[2]].filter(Boolean)) assert.ok(Number(n) >= 1 && Number(n) <= SECTIONS, "section " + n);
  }
});

test("the word exponential appears only to say we do not claim it", () => {
  const hits = [...proseOnly.matchAll(/[^.]*\bexponential\b[^.]*\./gi)].map((m) => m[0]);
  for (const s of hits) assert.match(s, /not claiming/i);
});

test("figures: every DeckFig in the post has a figure entry, a slide file and a manifest record", () => {
  const deck = join(here, "../src/components/illustrations/deck/");
  const figures = JSON.parse(readFileSync(join(deck, "figures.json"), "utf8"));
  const slides = JSON.parse(readFileSync(join(deck, "slides.json"), "utf8"));
  const names = [...body.matchAll(/<DeckFig name="([^"]+)" \/>/g)].map((m) => m[1]);
  assert.deepEqual(names, ["p6-api-line", "p6-agent-loop", "p6-parallelism-steps"]);
  assert.equal((post.match(/<DeckRuntime \/>/g) || []).length, 1);
  assert.ok(post.indexOf("<DeckRuntime />") < post.indexOf("<DeckFig "));
  for (const name of names) {
    assert.ok(figures[name], "figure " + name);
    for (const id of figures[name].slides) {
      assert.ok(existsSync(join(deck, "slides", id + ".html")), "slide file " + id);
      assert.ok(slides[id], "slide manifest " + id);
      assert.ok(figures[name].captions[id].length > 20 && /\)\.?$/.test(figures[name].captions[id]), "caption tag " + id);
    }
  }
});

test("numbers in the prose: the machine prices, staircase and replica sizes match the data and the calculator", () => {
  const offer = (id) => data.rentOffers.find((o) => o.id === id);
  const month = (id) => Math.round(offer(id).pricePerHour * HOURS_PER_MONTH * 100) / 100;
  assert.equal(offer("AWS:g7e.2xlarge:on_demand").pricePerHour, 3.36312);
  assert.equal(month("AWS:g7e.2xlarge:on_demand"), 2453.73);
  assert.equal(Math.round((month("AWS:g7e.2xlarge:on_demand") / 6) * 100) / 100, 408.96);
  assert.equal(offer("AWS:g7e.12xlarge:on_demand").pricePerHour, 8.28608);
  assert.equal(month("AWS:g7e.12xlarge:on_demand"), 6045.52);
  assert.equal(offer('Modal:gpu="B200":on_demand').pricePerHour, 6.2496);
  assert.equal(offer('Modal:gpu="B300":on_demand').pricePerHour, 7.0992);
  assert.equal(offer("Nebius:8x B200 (8gpu-160vcpu-1792gb):on_demand").pricePerHour, 68);
  assert.equal(offer("Nebius:8x B300 (8gpu-192vcpu-2768gb):on_demand").pricePerHour, 76);
  const server = (id) => data.buyOptions.servers.find((s) => s.id === id).priceUsd;
  assert.equal(Math.round(server("b200-8")), 562154);
  assert.equal(Math.round(server("b300-8")), 646878);
  // the figure's right panel: Qwen3.8 Flash Next at 4 bits needs 2 GPUs per replica and its memory holds 10 requests
  // of the full 262,144-token window per replica (the memory limit, whatever the workload or speed target)
  const gpu = data.gpus.find((g) => g.id === "rtx6000pro");
  const flash = data.models.find((m) => m.id === "qwen3.8-flash-next");
  assert.equal(minGpus(flash, 4, gpu, 262144), 2);
  assert.equal(Math.floor(stepModel(flash, 4, gpu, 2, 4000, 500, 1, { ctx: 262144 }).bMax), 10);
  // the machine of part 4: the memory model says 7 for Qwen3.8 27B on one card, the vLLM log of part 4 says 6.38
  const qwen = data.models.find((m) => m.id === "qwen3.8-27b");
  assert.equal(Math.floor(stepModel(qwen, 4, gpu, 1, 4000, 500, 1, { ctx: 262144 }).bMax), 7);
  for (const [tag, n] of [["$2,453.73", 1], ["$4,907.46", 2], ["$7,361.20", 3], ["$9,814.93", 4]]) {
    assert.equal("$" + (offer("AWS:g7e.2xlarge:on_demand").pricePerHour * HOURS_PER_MONTH * n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }), tag);
  }
});

test("numbers in the prose: the API examples", () => {
  const sonnet = data.apiPrices.find((p) => p.id === "Anthropic:claude-sonnet-5-5");
  assert.deepEqual([sonnet.input, sonnet.cachedInput, sonnet.output], [2, 0.1, 10]);
  const usd = (inTok, cachedTok, outTok) => (inTok * sonnet.input + cachedTok * sonnet.cachedInput + outTok * sonnet.output) / 1e6;
  assert.equal(usd(10000, 0, 1000).toFixed(4), "0.0300");
  assert.equal(usd(2000, 8000, 1000).toFixed(4), "0.0148");
  assert.equal((usd(2000, 8000, 1000) * 1000).toFixed(2), "14.80");
  assert.equal(Math.round(usd(2000, 8000, 1000) * 1e6), 14800);
  // 50-turn loop of the agent section
  const [c0, d, o, N] = [20000, 5000, 1000, 50];
  const input = N * c0 + (d + o) * ((N * (N - 1)) / 2);
  assert.equal(input, 8350000);
  assert.equal(c0 + (N - 1) * (d + o), 314000);
  const opus = data.apiPrices.find((p) => p.id === "Anthropic:claude-opus-5-5");
  const noCache = (input * opus.input + N * o * opus.output) / 1e6;
  const cached = (314000 * opus.input * 1.25 + (input - 314000) * opus.cachedInput + N * o * opus.output) / 1e6;
  assert.equal(noCache.toFixed(2), "34.40");
  assert.equal(cached.toFixed(2), "4.18");
});

test("calculator defaults: the part 4 machine, the full 262,144-token window reserved, evaluates cleanly", () => {
  const st = normalizeState({ ...DEFAULT_STATE }, data);
  assert.equal(st.ctx, 262144);
  assert.equal(st.rentOfferId, "AWS:g7e.2xlarge:on_demand");
  const r = evaluate(st, data);
  assert.deepEqual(r.errors, []);
  assert.equal(r.self.offered, true);
  assert.ok(buildView(r, st, data).headline.length > 20);
});

test("idle power: the prose says an owned server draws power when idle, and the calculator bills the rated draw for every hour whatever the load", () => {
  assert.match(proseOnly, /Idle isn't free for an owner either\./);
  assert.match(proseOnly, /for all 730 hours of the month/);
  // The reader's figure is attributed, not stated as a general fact.
  assert.match(proseOnly, /One reader measured about 1\.1 kW on their own 8-GPU server/);
  // The 14.3 kW in the prose is the published maximum of the 8-GPU B200 server in the data, and 730 is the data's month.
  const b200 = data.buyOptions.servers.find((s) => s.id === "b200-8");
  assert.equal(b200.powerKw, 14.3);
  assert.equal(b200.powerKind, "published");
  assert.equal(data.buyOptions.defaults.hoursPerMonth, 730);
  assert.match(proseOnly, /\[14\.3 kW maximum NVIDIA lists\]\(https:\/\/www\.nvidia\.com\/en-us\/data-center\/dgx-b200\/\)/);
  // The energy line does not move with the hours of use or the load: a bought server is billed for the whole month.
  const base = normalizeState({ ...DEFAULT_STATE, mode: "buy", buyGpu: "b200" }, data);
  const busy = evaluate({ ...base, hoursPerDay: 24 }, data);
  const part = evaluate({ ...base, hoursPerDay: 4 }, data);
  assert.ok(busy.self.offered && part.self.offered);
  assert.equal(part.self.parts.energy, busy.self.parts.energy);
  const expected = busy.self.servers * 14.3 * data.buyOptions.defaults.pue * 730 * data.buyOptions.defaults.electricityUsdPerKwh;
  assert.ok(Math.abs(busy.self.parts.energy - expected) < 1e-6, "energy = servers x rated kW x PUE x 730 h x price");
});
