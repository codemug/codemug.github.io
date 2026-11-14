// api_prices.json from seeds/api_closed.json and seeds/api_focus.json.
// The open-weight reference price of each model is the one its seed row names; closed models keep their listed prices.
import { readSeed, fail } from "./read.mjs";
import { buildModels } from "./models.mjs";

const CLAUDE_IDS = ["claude-sonnet-5-5", "claude-opus-5-5", "claude-fable-5-1"];
// Deprecation marker with an ISO date. The notes use month names, but the
// ISO dates live in the seed effective field (notes use month names); check both.
const DEPR_RE = /(shutdown|retire|deprecat)[^.]*?(\d{4}-\d{2}-\d{2})/i;
const FROM_RE = /^Gemini API standard, from (\d{4}-\d{2}-\d{2})$/;
const PROMO_RE = /, (promo|intro) through (\d{4}-\d{2}-\d{2})$/;
function deprDate(row) {
  const m = `${row.notes ?? ""} | ${row.effective ?? ""}`.match(DEPR_RE);
  return m ? m[2] : null;
}

function median(values) {
  const v = [...values].sort((a, b) => a - b);
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

// Long-context tier from the seed long_context_* fields (Clarification 4).
function tiersFor(row) {
  if (row.long_context_threshold_tokens == null) return { tiers: [], note: null };
  const base = row.cached_input_per_mtok;
  const cached = base == null ? null : (base * row.long_context_input_per_mtok) / row.input_per_mtok;
  return {
    tiers: [{ aboveInputTokens: row.long_context_threshold_tokens, input: row.long_context_input_per_mtok, cachedInput: cached, output: row.long_context_output_per_mtok }],
    note: cached == null ? null : "Cached tokens in the long-context tier are priced with the same multiplier as input tokens (derived, not published)",
  };
}

// Record-level note: promo/intro in-force window for Gemini, and the promo situation for gpt-5.6-sol.
function noteFor(row) {
  const notes = [];
  if (row.provider === "OpenAI" && row.model_id === "gpt-5.6-sol") {
    notes.push("Promotional price in force; the earlier price was higher and the price after the promotion has not been published");
  }
  const m = (row.region_or_tier ?? "").match(PROMO_RE);
  if (m) notes.push(`${m[1]} price in force until ${m[2]}`);
  return notes.length ? notes.join("; ") : null;
}

function closedRecord(group, row, scheduled) {
  const { tiers, note } = tiersFor(row);
  const notes = [noteFor(row), note].filter(Boolean);
  return {
    id: `${row.provider}:${row.model_id}`,
    provider: row.provider,
    model: row.model_name,
    group,
    linkedModelId: null,
    input: row.input_per_mtok,
    cachedInput: row.cached_input_per_mtok ?? null,
    output: row.output_per_mtok,
    tiers,
    scheduled,
    deprecated: null,
    contextWindow: row.context_window ?? null,
    sourceUrl: row.source_url,
    sourceKind: row.source_kind,
    captured: row.captured,
    note: notes.length ? notes.join("; ") : null,
  };
}

function buildClosed() {
  const rows = readSeed("api_closed.json");
  if (!Array.isArray(rows)) fail(["api_closed.json: expected a JSON array"]);
  const label = (r) => `${r.provider}:${r.model_id}:${r.region_or_tier}`;
  const scheduledByModel = new Map();
  const dropped = { deprecated: [], nullPrice: [], scheduledOnly: [], filtered: [] };
  const pending = [];
  for (const row of rows) {
    let group = null;
    let reason = "provider";
    if (row.provider === "Anthropic" && row.region_or_tier === "global standard") {
      if (CLAUDE_IDS.includes(row.model_id)) group = "claude";
      else reason = "model";
    } else if (row.provider === "OpenAI" && row.region_or_tier === "global standard") {
      group = "openai";
    } else if (row.provider === "Google" && (row.region_or_tier ?? "").startsWith("Gemini API standard")) {
      group = "gemini";
    } else if (row.provider === "Anthropic" || row.provider === "OpenAI" || row.provider === "Google") {
      reason = "tier";
    }
    if (group === null) {
      if (reason !== "model" && /alias/i.test(row.notes || "")) reason = "alias";
      dropped.filtered.push({ id: label(row), reason });
      continue;
    }
    // Floating alias ids (e.g. chat-latest) duplicate the pinned model.
    if (/alias/i.test(row.notes || "")) {
      dropped.filtered.push({ id: label(row), reason: "alias" });
      continue;
    }
    const date = deprDate(row);
    if (date) {
      dropped.deprecated.push({ id: label(row), date });
      continue;
    }
    if (row.input_per_mtok == null || row.output_per_mtok == null) {
      dropped.nullPrice.push({ id: label(row), reason: "null input or output" });
      continue;
    }
    if (group === "gemini") {
      const m = row.region_or_tier.match(FROM_RE);
      if (m) {
        // Not a record: attached to the same model_id as a scheduled entry.
        dropped.scheduledOnly.push({ id: label(row), reason: "future price only" });
        const list = scheduledByModel.get(row.model_id) ?? [];
        list.push({ effective: m[1], input: row.input_per_mtok, cachedInput: row.cached_input_per_mtok ?? null, output: row.output_per_mtok, note: `price changes on ${m[1]}` });
        scheduledByModel.set(row.model_id, list);
        continue;
      }
    }
    pending.push({ group, row });
  }
  const out = pending.map(({ group, row }) => closedRecord(group, row, scheduledByModel.get(row.model_id) ?? []));
  const questions = [];
  for (const [modelId] of scheduledByModel) {
    if (!out.some((r) => r.provider === "Google" && r.id === `Google:${modelId}`)) {
      questions.push(`gemini ${modelId}: a "from <date>" row has no matching current-price row; its scheduled entry was dropped`);
      scheduledByModel.delete(modelId);
    }
  }
  return { records: out, dropped, questions };
}

function buildReference(modelNames) {
  const entries = readSeed("reference_prices.json");
  const focus = readSeed("api_focus.json");
  if (!Array.isArray(entries) || !Array.isArray(focus)) fail(["reference_prices.json / api_focus.json: expected JSON arrays"]);
  const out = [];
  for (const e of entries) {
    if (!modelNames.has(e.modelId)) fail([`reference_prices: model id ${e.modelId} is not one of the models.json ids`]);
    if (e.rule === "maker" && e.picks.length !== 1) fail([`reference_prices ${e.modelId}: maker rule needs exactly one pick`]);
    const rows = [];
    for (const p of e.picks) {
      const hit = focus.filter((r) => r.provider === p.provider && r.model_id === p.model_id && r.region_or_tier === p.region_or_tier);
      if (hit.length !== 1) {
        fail([`reference_prices ${e.modelId}: pick ${p.provider} ${p.model_id} ${p.region_or_tier} matches ${hit.length} api_focus rows, expected 1`]);
      }
      rows.push(hit[0]);
    }
    let input, cached, output, provider, sourceKind;
    if (e.rule === "maker") {
      input = rows[0].input_per_mtok;
      cached = rows[0].cached_input_per_mtok ?? null;
      output = rows[0].output_per_mtok;
      provider = "Maker API";
      sourceKind = rows[0].source_kind;
    } else if (e.rule === "median") {
      input = median(rows.map((r) => r.input_per_mtok));
      output = median(rows.map((r) => r.output_per_mtok));
      const caches = rows.map((r) => r.cached_input_per_mtok).filter((v) => v != null);
      cached = caches.length ? median(caches) : null;
      provider = `Median of ${rows.length} hosts`;
      sourceKind = "derived";
    } else {
      fail([`reference_prices ${e.modelId}: unknown rule ${e.rule}`]);
    }
    if (input == null || output == null) fail([`reference_prices ${e.modelId}: resolved prices are null`]);
    out.push({
      id: `ref:${e.modelId}`,
      provider,
      model: modelNames.get(e.modelId),
      group: "open_weight_reference",
      linkedModelId: e.modelId,
      input,
      cachedInput: cached,
      output,
      tiers: [],
      scheduled: [],
      deprecated: null,
      contextWindow: rows[0].context_window ?? null,
      sourceUrl: rows[0].source_url,
      sourceUrls: rows.map((r) => r.source_url),
      sourceKind,
      captured: rows.map((r) => r.captured).sort()[0],
      note: rows.map((r) => r.provider).join(", "),
    });
  }
  return out;
}

const STANDING_QUESTIONS = [
  "deprecation check: Clarification 4 says match notes, but the ISO dates sit in the seed effective field (notes use month names); the regex was applied to notes and effective together.",
  "gpt-5.6-sol: the seed carries only the in-force promotional price row; the pre-promo price exists solely as a notes derivation and the post-promo price is unpublished, so no scheduled entry is emitted.",
  "deprecated field: deprecated rows are dropped per Clarification 4, so deprecated is null on every emitted record; confirm this rather than keeping them marked.",
];

export function buildPrices() {
  const modelNames = new Map(buildModels().map((m) => [m.id, m.name]));
  const { records, dropped, questions } = buildClosed();
  return { records: [...records, ...buildReference(modelNames)], dropped, questions: [...questions, ...STANDING_QUESTIONS] };
}
