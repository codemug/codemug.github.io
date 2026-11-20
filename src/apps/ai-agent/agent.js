// Pure agent logic (no DOM): tool definitions, tool-call parsing and visible-text extraction.
// Qwen3.5 and LFM3 both emit: <tool_call>\n<function=NAME>\n<parameter=ARG>\nVALUE\n</parameter>\n</function>\n</tool_call>
import { MAX_WRITE_CHARS } from "./file-tools.js";

const SAFE_EXPRESSION = /^[\d\s+\-*/().,%^]+$/;
const MAX_QUERY_CHARS = 200;
const MAX_CODE_CHARS = 10_000;
const MAX_CHROME_TEXT_CHARS = 4_000;
const LANG_CODE = /^[a-z]{2,3}(-[A-Za-z]{2,8})*$/;

/**
 * A terminal exec-service reply (exec-result / exec-error over BroadcastChannel) reduced to the
 * model-facing tool result. `no-terminal` is synthesized by the bridge when the wall timer
 * expires without any reply (the terminal app is not open, or approval/run is still pending).
 */
export function execReplyToToolResult(reply) {
  if (reply?.type === "exec-result") return { exitCode: reply.exitCode, output: String(reply.output ?? ""), truncated: reply.truncated === true };
  if (reply?.type === "exec-error" && reply.reason === "timeout") return { error: "The run exceeded its time limit and was interrupted with Ctrl+C.", output: String(reply.output ?? ""), truncated: reply.truncated === true };
  const reason = reply?.type === "exec-error" ? reply.reason : "invalid";
  const message = {
    "not-running": "The Linux guest is not running. The user needs to open the Linux Terminal app and press Start Linux first.",
    denied: "The user denied this run.",
    busy: "Another command is already running in the terminal; try again shortly.",
    "no-terminal": "No reply from the Linux Terminal app: it may not be open, or the run is still waiting for the user's approval. Check the terminal window before trying again.",
    invalid: "The run request was rejected.",
  }[reason] ?? `The run failed (${String(reason)}).`;
  return { error: message };
}

/** @typedef {{ name: string, arguments: Record<string, unknown> }} ToolCall */

/**
 * Tool table. `run` validates the model's arguments and returns a JSON-able result (or a Promise of one).
 * The host supplies everything that needs the DOM or the network.
 * @param {{
 *   webSearch: (query: string) => Promise<object>,
 *   httpGet: (url: string) => Promise<object>,
 *   runJavaScript: (code: string) => Promise<object>,
 *   allowedHosts: () => Set<string>,
 *   translate?: (text: string, target: string, source: string) => Promise<object>,
 *   summarize?: (text: string, type: string) => Promise<object>,
 *   detectLanguage?: (text: string) => Promise<object>,
 *   listFiles?: (path: string) => Promise<object>,
 *   readFile?: (path: string) => Promise<object>,
 *   writeFile?: (path: string, content: string) => Promise<object>,
 *   searchFiles?: (query: string, k: number) => Promise<object>,
 *   runCode?: (lang: string, code: string, timeoutMs: number) => Promise<object>,
 * }} host
 */
export function createTools(host) {
  const tools = {
    calculate: {
      description: "Evaluate an arithmetic expression with + - * / ^ % and parentheses, e.g. (12.5*4)/3.",
      parameters: {
        type: "object",
        properties: { expression: { type: "string", description: "Arithmetic expression" } },
        required: ["expression"],
      },
      run: ({ expression }) => {
        const expr = String(expression ?? "").replace(/,/g, "");
        // The whitelist allows only digits and operators, so Function() cannot reach any identifier.
        if (!SAFE_EXPRESSION.test(expr)) return { error: "Only numbers and + - * / ^ % ( ) are allowed" };
        try {
          const value = Function(`"use strict"; return (${expr.replace(/\^/g, "**")});`)();
          return Number.isFinite(value) ? { result: Number(value.toPrecision(12)) } : { error: "Not a finite number" };
        } catch {
          return { error: "Invalid expression" };
        }
      },
    },
    web_search: {
      description: "Search Wikipedia for facts about people, places, things and events. Returns titles, links and snippets.",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "A few search words, e.g. Eiffel Tower height" } },
        required: ["query"],
      },
      run: ({ query }) => {
        const q = String(query ?? "").trim();
        if (!q || q.length > MAX_QUERY_CHARS) return { error: `query must be 1 to ${MAX_QUERY_CHARS} characters` };
        return host.webSearch(q);
      },
    },
    http_get: {
      description: "Read a web page or JSON API and return its main text. Only for a site the user named or a link from web_search.",
      parameters: {
        type: "object",
        properties: { url: { type: "string", description: "Full http or https URL" } },
        required: ["url"],
      },
      run: ({ url }) => {
        const checked = checkUrl(url, host.allowedHosts());
        return checked.error ? checked : host.httpGet(checked.url);
      },
    },
    run_javascript: {
      description: "Run JavaScript in an isolated sandbox (no network, no page access, 5 second limit) for logic, dates, text or data processing. Print with console.log or end with a return statement.",
      parameters: {
        type: "object",
        properties: { code: { type: "string", description: "JavaScript code; the last expression or a return statement is the result, e.g. [10, 9, 100].sort((a, b) => a - b)" } },
        required: ["code"],
      },
      run: ({ code }) => {
        const src = String(code ?? "");
        if (!src.trim() || src.length > MAX_CODE_CHARS) return { error: `code must be 1 to ${MAX_CODE_CHARS} characters` };
        return host.runJavaScript(src);
      },
    },
  };
  // Guest Linux runs (AI-4), offered when the host wires the terminal app's exec service
  // (BroadcastChannel bridge). The terminal app asks the user to approve every run, so the
  // reply only arrives once the run finishes, is denied, or the guest is not running.
  if (host.runCode) tools.run_code = {
    description: "Run code in WebPC's Linux guest (real Alpine Linux) and return its exit code and output. lang is python, node or sh; for SQL use Python's sqlite3 module. The user approves every run in the terminal app. Output is the last 64 KB (truncated flags the head).",
    parameters: {
      type: "object",
      properties: {
        code: { type: "string", description: `Code to run (max ${MAX_CODE_CHARS} characters)` },
        lang: { type: "string", description: "python, node or sh" },
        timeout_ms: { type: "number", description: "Optional run limit in milliseconds, 1-120000 (default 30000); the run is interrupted with Ctrl+C at the limit and the partial output is returned" },
      },
      required: ["code", "lang"],
    },
    run: ({ code, lang, timeout_ms }) => {
      const src = String(code ?? "");
      if (!src.trim() || src.length > MAX_CODE_CHARS) return { error: `code must be 1 to ${MAX_CODE_CHARS} characters` };
      if (lang !== "python" && lang !== "node" && lang !== "sh") return { error: "lang must be python, node or sh" };
      const timeout = timeout_ms === undefined ? 30000 : timeout_ms;
      if (typeof timeout !== "number" || !Number.isFinite(timeout) || timeout < 1 || timeout > 120000) return { error: "timeout_ms must be a number from 1 to 120000" };
      return host.runCode(lang, src, timeout).then(execReplyToToolResult);
    },
  };
  // Chrome built-in on-device tools, offered only when the app reports the matching API available or
  // downloadable (see chrome-ai.js). They run on the page, and their results are untrusted tool data.
  if (host.translate) tools.translate = {
    description: `Translate text on this device with Chrome's Translator API. target_language is a BCP 47 code like 'fr'; call detect_language first when the source language is unknown (otherwise English is assumed).`,
    parameters: {
      type: "object",
      properties: {
        text: { type: "string", description: `Text to translate (max ${MAX_CHROME_TEXT_CHARS} characters)` },
        target_language: { type: "string", description: "BCP 47 target language code, e.g. 'fr'" },
        source_language: { type: "string", description: "BCP 47 source language code; omit to assume English" },
      },
      required: ["text", "target_language"],
    },
    run: ({ text, target_language, source_language }) => {
      const t = String(text ?? "");
      if (!t.trim() || t.length > MAX_CHROME_TEXT_CHARS) return { error: `text must be 1 to ${MAX_CHROME_TEXT_CHARS} characters` };
      if (typeof target_language !== "string" || !LANG_CODE.test(target_language)) return { error: "target_language must be a BCP 47 code like 'fr' or 'de-CH'" };
      const source = source_language == null ? "en" : String(source_language);
      if (!LANG_CODE.test(source)) return { error: "source_language must be a BCP 47 code" };
      return host.translate(t, target_language, source);
    },
  };
  if (host.summarize) tools.summarize = {
    description: "Summarize text on this device with Chrome's Summarizer API.",
    parameters: {
      type: "object",
      properties: {
        text: { type: "string", description: `Text to summarize (max ${MAX_CHROME_TEXT_CHARS} characters)` },
        type: { type: "string", description: "key-points (default), tldr, teaser or headline" },
      },
      required: ["text"],
    },
    run: ({ text, type }) => {
      const t = String(text ?? "");
      if (!t.trim() || t.length > MAX_CHROME_TEXT_CHARS) return { error: `text must be 1 to ${MAX_CHROME_TEXT_CHARS} characters` };
      const kind = type == null ? "key-points" : String(type);
      if (!["key-points", "tldr", "teaser", "headline"].includes(kind)) return { error: "type must be key-points, tldr, teaser or headline" };
      return host.summarize(t, kind);
    },
  };
  if (host.detectLanguage) tools.detect_language = {
    description: "Detect the language of text on this device with Chrome's Language Detector API. Returns the detected code and confidence.",
    parameters: {
      type: "object",
      properties: { text: { type: "string", description: `Text to inspect (max ${MAX_CHROME_TEXT_CHARS} characters)` } },
      required: ["text"],
    },
    run: ({ text }) => {
      const t = String(text ?? "");
      if (!t.trim() || t.length > MAX_CHROME_TEXT_CHARS) return { error: `text must be 1 to ${MAX_CHROME_TEXT_CHARS} characters` };
      return host.detectLanguage(t);
    },
  };
  // Files tools (AI-2), offered only while the user has at least one grant: paths are relative to the
  // grant root, the resolver rejects escapes, and results are untrusted tool data like the others.
  if (host.listFiles) tools.list_files = {
    description: "List the files and folders the user granted you, or a subfolder of them. Omit path (or use '') for the grant root.",
    parameters: {
      type: "object",
      properties: { path: { type: "string", description: "Folder to list, relative to the grant root" } },
      required: [],
    },
    run: ({ path }) => host.listFiles(path == null ? "" : String(path)),
  };
  if (host.readFile) tools.read_file = {
    description: "Read a granted text file (txt, md, csv, json, html, xml, js, py and similar; UTF-8, at most 200 KB). PDFs are not supported — PDFCraft is.",
    parameters: {
      type: "object",
      properties: { path: { type: "string", description: "File to read, relative to the grant root" } },
      required: ["path"],
    },
    run: ({ path }) => host.readFile(String(path ?? "")),
  };
  if (host.writeFile) tools.write_file = {
    description: "Create or update a text file inside a granted FOLDER; the user confirms every write and overwrites are announced. The parent folder must already exist.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "File to write, relative to the grant root" },
        content: { type: "string", description: `Full file content, UTF-8 (max ${MAX_WRITE_CHARS} characters)` },
      },
      required: ["path", "content"],
    },
    run: ({ path, content }) => {
      const p = String(path ?? ""); const c = String(content ?? "");
      if (!p.trim() || p.length > 200) return { error: "path must be 1 to 200 characters" };
      if (c.length > MAX_WRITE_CHARS) return { error: `content is too large (max ${MAX_WRITE_CHARS} characters)` };
      return host.writeFile(p, c);
    },
  };
  // Files search (AI-3): offered only while the in-memory index has chunks. Runs the local embedding
  // model on this device; the returned chunks are untrusted tool data like the other file tools.
  if (host.searchFiles) tools.search_files = {
    description: "Search the granted files by meaning (local embedding model, on this device). Returns the most similar chunks: path, similarity score (0-1) and a snippet.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: `What to look for (max ${MAX_QUERY_CHARS} characters)` },
        k: { type: "number", description: "How many chunks to return (integer 1-10, default 5)" },
      },
      required: ["query"],
    },
    run: ({ query, k }) => {
      const q = String(query ?? "");
      if (!q.trim() || q.length > MAX_QUERY_CHARS) return { error: `query must be 1 to ${MAX_QUERY_CHARS} characters` };
      if (k !== undefined && (typeof k !== "number" || !Number.isInteger(k))) return { error: "k must be an integer from 1 to 10" };
      const n = k === undefined ? 5 : k;
      if (n < 1 || n > 10) return { error: "k must be an integer from 1 to 10" };
      return host.searchFiles(q, n);
    },
  };
  return tools;
}

/**
 * http_get may only reach hosts the user named or web_search returned, so text injected into a fetched page
 * cannot make the model send the conversation to an arbitrary server.
 * @returns {{ url: string } | { error: string }}
 */
export function checkUrl(raw, allowedHosts) {
  const text = String(raw ?? "").trim();
  let url;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`); // "bbc.com" means https
  } catch {
    return { error: "Not a valid URL" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return { error: "Only http and https URLs are allowed" };
  const host = url.hostname.replace(/^www\./, "");
  const allowed = [...allowedHosts].some((h) => host === h || host.endsWith(`.${h}`));
  return allowed ? { url: url.href } : { error: `${host} was not mentioned by the user or found by web_search` };
}

/**
 * Prompt copy of the history with each user message prefixed by the local time it was sent (`at`, ms epoch).
 * Stamps live on the messages themselves, so earlier turns render identically every time.
 */
export function stampUserMessages(history, formatTime) {
  return history.map((m) => (m.role === "user" && m.at != null ? { role: "user", content: `[${formatTime(m.at)}] ${m.content}` } : m));
}

/**
 * Small models sometimes open a reply by reading back the time stamp of the message. Drop an exact echo of
 * `stampText` (optionally in brackets) from the start; while the reply could still be one, hold it back ("").
 */
export function dropStampEcho(text, stampText) {
  const body = text.trimStart().replace(/^\[/, "");
  if (!body) return text;
  if (stampText.startsWith(body)) return "";
  return body.startsWith(stampText) ? body.slice(stampText.length).replace(/^[\]\s.,:;-]+/, "") : text;
}

/** Domain names in user text ("bbc.com", "news dot ycombinator dot com"), lowercased without www. */
export function hostsIn(text) {
  const normalized = String(text).toLowerCase().replace(/\s+dot\s+/g, ".");
  const hosts = new Set();
  for (const [domain] of normalized.matchAll(/\b(?:[a-z0-9-]+\.)+[a-z]{2,}\b/g)) hosts.add(domain.replace(/^www\./, ""));
  return hosts;
}

// Zero-width, bidi-control and Unicode tag characters can hide instructions from a human reader.
const INVISIBLE = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]|[\u{E0000}-\u{E007F}]/gu;

/** Untrusted text (web pages, search snippets) reduced to plain, bounded text before it reaches the model. */
export function cleanUntrusted(text, maxChars) {
  const plain = String(text ?? "")
    .replace(INVISIBLE, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "") // markdown images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // markdown links keep their text
    .split("\n").map((line) => line.replace(/\s+/g, " ").trim()).join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return plain.length > maxChars ? `${plain.slice(0, maxChars)} …[truncated]` : plain;
}

/** Tool schemas in the shape chat templates expect. */
export function toolSchemas(tools) {
  return Object.entries(tools).map(([name, t]) => ({
    type: "function",
    function: { name, description: t.description, parameters: t.parameters },
  }));
}

const TYPES = {
  string: (v) => typeof v === "string",
  number: (v) => typeof v === "number" && Number.isFinite(v),
  boolean: (v) => typeof v === "boolean",
  array: (v) => Array.isArray(v),
  object: (v) => v !== null && typeof v === "object" && !Array.isArray(v),
};

/**
 * Validate a parsed tool input against a tool's JSON-Schema parameters. The cloud tools run
 * `strict` schemas, so missing, extra or mistyped fields become error tool_results before running.
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
export function validateToolInput(parameters, args) {
  if (!TYPES.object(args)) return { ok: false, error: "Tool input must be a JSON object" };
  const properties = parameters?.properties ?? {};
  for (const key of Object.keys(args)) {
    const property = properties[key];
    if (!property) return { ok: false, error: `Unexpected field "${key}" is not allowed` };
    if (property.type && !TYPES[property.type]?.(args[key])) return { ok: false, error: `Field "${key}" must be ${property.type}` };
  }
  for (const key of parameters?.required ?? []) {
    if (!(key in args)) return { ok: false, error: `Missing required field "${key}"` };
  }
  return { ok: true };
}

/** Parse a parameter value: numbers, booleans and JSON objects come back typed, the rest as strings. */
function parseValue(raw) {
  const text = raw.trim();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** @returns {ToolCall[]} */
export function parseToolCalls(text) {
  const calls = [];
  for (const [, body] of text.matchAll(/<tool_call>([\s\S]*?)<\/tool_call>/g)) {
    const fn = body.match(/<function=([\w.-]+)>([\s\S]*?)(?:<\/function>|$)/);
    if (!fn) continue;
    const args = {};
    for (const [, key, value] of fn[2].matchAll(/<parameter=([\w.-]+)>([\s\S]*?)<\/parameter>/g)) {
      args[key] = parseValue(value);
    }
    calls.push({ name: fn[1], arguments: args });
  }
  return calls;
}

/** Run one call against the tool table; unknown tools, thrown errors and rejections become `{error}` results. */
export async function runToolCall(tools, call) {
  const tool = tools[call.name];
  if (!tool) return { error: `Unknown tool ${call.name}. Available tools: ${Object.keys(tools).join(", ")}` };
  try {
    return await tool.run(call.arguments ?? {});
  } catch (err) {
    return { error: String(err?.message ?? err) };
  }
}

// Internal model markup is withheld from the visible reply, including streamed prefixes.
const MARKUP = ["<tool_call", "<|", "<think", "</think"];

/** Index of the first model markup (or a streamed prefix of one, like "<tool_ca"), else -1; "n < 2" is not markup. */
function markupStart(text) {
  for (let i = text.indexOf("<"); i !== -1; i = text.indexOf("<", i + 1)) {
    const rest = text.slice(i);
    if (MARKUP.some((m) => rest.startsWith(m) || m.startsWith(rest))) return i;
  }
  return -1;
}

export function visibleText(raw) {
  const noThink = raw.replace(/<think>[\s\S]*?(<\/think>|$)/g, "");
  const cut = markupStart(noThink);
  const visible = cut === -1 ? noThink : noThink.slice(0, cut);
  return visible;
}

// ---------- compaction ----------
const CLEARED = "[old tool result removed]";

/** Index of the `turns`-th user message from the end (0 when there are fewer). */
function recentStart(history, turns) {
  let seen = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role === "user" && ++seen === turns) return i;
  }
  return 0;
}

/** Cheapest compaction, no LLM call: blank tool results older than the last `keepTurns` user turns. */
export function clearOldToolResults(history, keepTurns) {
  const start = recentStart(history, keepTurns);
  return history.map((m, i) => (i < start && m.role === "tool" ? { ...m, content: CLEARED } : m));
}

/** Split into turns to summarize and the last `keepTurns` user turns kept word for word (tool pairs stay together). */
export function splitForCompaction(history, keepTurns) {
  const start = recentStart(history, keepTurns);
  return { older: history.slice(0, start), recent: history.slice(start) };
}

/** Split text at line breaks into pieces of at most `maxChars` (longer lines are cut) so each summarizer call stays small. */
export function chunkText(text, maxChars) {
  const chunks = [];
  let current = "";
  for (const line of text.split("\n")) {
    for (let i = 0; i === 0 || i < line.length; i += maxChars) {
      const piece = line.slice(i, i + maxChars);
      if (current && current.length + piece.length + 1 > maxChars) {
        chunks.push(current);
        current = "";
      }
      current = current ? `${current}\n${piece}` : piece;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

/** Plain-text transcript for the summarizer; chat-formatted turns would make a small model continue the chat. */
export function transcriptText(messages, maxToolChars = 300) {
  return messages.map((m) => {
    if (m.role === "user") return `User: ${m.content}`;
    if (m.role === "tool") return `Tool result: ${String(m.content).slice(0, maxToolChars)}`;
    const calls = (m.tool_calls ?? []).map((c) => `Assistant called ${c.function.name}(${JSON.stringify(c.function.arguments)})`);
    return [m.content ? `Assistant: ${m.content}` : "", ...calls].filter(Boolean).join("\n");
  }).filter(Boolean).join("\n");
}

// ---------- image input ----------
export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];
export const IMAGE_MAX_BYTES = 10_000_000;
export const IMAGE_MAX_SIDE = 768;

/**
 * Boundary validation for an attached image (a File or {type,size}).
 * @returns {string|null} a human-readable problem, or null when the image may be used.
 */
export function checkImage(file) {
  if (!file || !IMAGE_TYPES.includes(file.type)) return `Only PNG, JPEG and WebP images are accepted${file?.type ? ` (${file.type})` : ""}.`;
  if (file.size > IMAGE_MAX_BYTES) return `That image is ${Math.ceil(file.size / 1_000_000)} MB; the limit is 10 MB.`;
  return null;
}

/** The text stored for a sent image; the pixels themselves are never persisted. */
export function imageMarker(image) {
  return `[image: ${image.name}, ${image.width}×${image.height}]`;
}

/** Drop image payloads ({name,width,height,data}) from a history before it is stored or exported. */
export function stripImages(history) {
  return history.map((m) => {
    const { image, ...rest } = m;
    return rest;
  });
}
