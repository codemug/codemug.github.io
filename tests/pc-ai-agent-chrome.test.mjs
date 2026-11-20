// Unit tests for AI-6: Chrome built-in on-device AI — feature detection (mocked globals),
// the on-device tool schemas and input bounds, executor caching, and the on-device chat client
// (streaming, history as initialPrompts, Stop abort, QuotaExceededError). No real Chrome APIs.
// Run: node --test tests/pc-ai-agent-chrome.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTools, toolSchemas } from '../src/apps/ai-agent/agent.js';
import { chromeAvailability, chromeExecutors, chromeDownload, chromeToolGates, ChromeModelClient } from '../src/apps/ai-agent/chrome-ai.js';
import { AgentSession } from '../src/apps/ai-agent/session.js';

const base = { webSearch: async () => ({ results: [] }), httpGet: async () => ({}), runJavaScript: async () => ({ result: 1 }), allowedHosts: () => new Set() };
const exec = {
  translate: async (t, target, source) => ({ result: `[${target}] ${t} (${source})` }),
  summarize: async (t, type) => ({ result: `[${type}] ${t.slice(0, 10).trimEnd()}` }),
  detectLanguage: async () => ({ language: 'de', confidence: 0.999 }),
};

test('feature detection: available, downloadable, missing and throwing globals', async () => {
  const ok = { availability: async () => 'available' };
  const down = { availability: async () => 'downloadable' };
  assert.deepEqual(await chromeAvailability({ LanguageModel: ok, Translator: ok, Summarizer: ok, LanguageDetector: ok }),
    { languageModel: 'available', translator: 'available', summarizer: 'available', detector: 'available' });
  assert.deepEqual(await chromeAvailability({ LanguageModel: down, Translator: down, Summarizer: down, LanguageDetector: down }),
    { languageModel: 'downloadable', translator: 'downloadable', summarizer: 'downloadable', detector: 'downloadable' });
  assert.deepEqual(await chromeAvailability({}),
    { languageModel: 'unavailable', translator: 'unavailable', summarizer: 'unavailable', detector: 'unavailable' });
  assert.deepEqual(await chromeAvailability({ LanguageModel: { availability: async () => { throw new Error('no device') } } }),
    { languageModel: 'unavailable', translator: 'unavailable', summarizer: 'unavailable', detector: 'unavailable' });
});

test('unavailable Chrome APIs offer no tools; available ones add exactly three', () => {
  const none = createTools(base);
  assert.deepEqual(Object.keys(none).sort(), ['calculate', 'http_get', 'run_javascript', 'web_search']);
  const withTools = createTools({ ...base, ...exec });
  assert.deepEqual(Object.keys(withTools).sort(), ['calculate', 'detect_language', 'http_get', 'run_javascript', 'summarize', 'translate', 'web_search']);
  const schemas = toolSchemas(withTools);
  assert.deepEqual(schemas.find((s) => s.function.name === 'translate').function.parameters.required, ['text', 'target_language']);
  assert.deepEqual(schemas.find((s) => s.function.name === 'summarize').function.parameters.required, ['text']);
  assert.deepEqual(schemas.find((s) => s.function.name === 'detect_language').function.parameters.required, ['text']);
});

test('Chrome tool inputs are bounded and validated before the API is called', async () => {
  const tools = createTools({ ...base, ...exec });
  const big = 'a'.repeat(4001);
  assert.match((await tools.translate.run({ text: big, target_language: 'fr' })).error, /4000/);
  assert.match((await tools.translate.run({ text: 'hi', target_language: 'french' })).error, /BCP 47/);
  assert.match((await tools.translate.run({ text: 'hi', target_language: 'fr', source_language: 'not-a-code!' })).error, /BCP 47/);
  assert.deepEqual(await tools.translate.run({ text: 'hi', target_language: 'fr' }), { result: '[fr] hi (en)' }, 'omitted source language defaults to English');
  assert.match((await tools.summarize.run({ text: big })).error, /4000/);
  assert.match((await tools.summarize.run({ text: 'text', type: 'essay' })).error, /key-points, tldr, teaser or headline/);
  assert.deepEqual(await tools.summarize.run({ text: 'some text here' }), { result: '[key-points] some text' }, 'type defaults to key-points');
  assert.match((await tools.detect_language.run({ text: '   ' })).error, /4000/);
  assert.deepEqual(await tools.detect_language.run({ text: 'Hallo' }), { language: 'de', confidence: 0.999 });
});

test('executors create instances once per pair/type and report a download status line', async () => {
  const statuses = []; const calls = { translator: 0, summarizer: 0, detector: 0 };
  const scope = {
    Translator: { create: async ({ monitor }) => { calls.translator += 1; monitor?.({ addEventListener: (t, f) => { if (t === 'downloadprogress') f({ loaded: 0.5 }); } }); return { translate: async (t) => `T(${t})` }; } },
    Summarizer: { create: async () => { calls.summarizer += 1; return { summarize: async (t) => `S(${t})` }; } },
    LanguageDetector: { create: async () => { calls.detector += 1; return { detect: async () => [{ detectedLanguage: 'fr', confidence: 0.98 }] }; } },
  };
  const e = chromeExecutors(scope, (t) => statuses.push(t));
  assert.deepEqual(await e.translate('bon', 'fr', 'en'), { result: 'T(bon)' });
  assert.deepEqual(await e.translate('bonjour', 'fr', 'en'), { result: 'T(bonjour)' });
  assert.equal(calls.translator, 1, 'the translator is cached per language pair');
  assert.deepEqual(await e.summarize('text', 'tldr'), { result: 'S(text)' });
  assert.deepEqual(await e.detectLanguage('bonjour'), { language: 'fr', confidence: 0.98 });
  assert.ok(statuses.some((s) => s.includes('translate')), 'a download status line is shown');
});

// Fake LanguageModel with the documented shape: availability(), create({initialPrompts, signal}),
// session.promptStreaming(text, {signal}) as an async iterable that honours the abort signal.
const fakeLanguageModel = () => {
  const seen = { creates: 0, initialPrompts: null, lastText: null };
  const LM = {
    availability: async () => 'available',
    create: async (opts = {}) => {
      seen.creates += 1; seen.initialPrompts = opts.initialPrompts;
      return {
        promptStreaming: (text, { signal }) => ({
          async *[Symbol.asyncIterator]() {
            seen.lastText = text;
            yield 'On-device ';
            const aborted = new Promise((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }));
            await Promise.race([new Promise((r) => setTimeout(r, 10)), aborted]);
            yield 'answer.';
          },
        }),
      };
    },
  };
  return { LM, seen };
};

test('the on-device client streams text and sends the history as initialPrompts', async () => {
  const { LM, seen } = fakeLanguageModel();
  const client = new ChromeModelClient({ LanguageModel: LM });
  await client.load(() => {});
  assert.equal(client.ready, true);
  const parts = [];
  const out = await client.generate([{ role: 'system', content: 'SYS' }, { role: 'user', content: 'hello' }], [], (p) => parts.push(p));
  assert.equal(out, 'On-device answer.');
  assert.deepEqual(parts, ['On-device ', 'answer.']);
  assert.deepEqual(seen.initialPrompts, [{ role: 'system', content: 'SYS' }], 'everything but the latest user message is context');
  assert.equal(seen.lastText, 'hello');
});

test('stop() aborts a streaming on-device turn with the standard Stopped error', async () => {
  const { LM } = fakeLanguageModel();
  const client = new ChromeModelClient({ LanguageModel: LM });
  await client.load(() => {});
  const pending = client.generate([{ role: 'user', content: 'go' }], [], () => {});
  setTimeout(() => client.stop(), 2);
  await assert.rejects(pending, (e) => e.name === 'AbortError' && e.message === 'Stopped');
});

test('QuotaExceededError (context overflow) maps to a friendly error', async () => {
  const LM = { availability: async () => 'available', create: async () => ({ promptStreaming: () => { const e = new Error('overflow'); e.name = 'QuotaExceededError'; throw e; } }) };
  const client = new ChromeModelClient({ LanguageModel: LM });
  client.ready = true;
  await assert.rejects(client.generate([{ role: 'user', content: 'x' }], [], () => {}), /too long for the on-device model/);
});

test('the on-device session is destroyed after every generate (success and error), and onToken has a default (review 17)', async () => {
  let destroyed = 0;
  const LM = {
    availability: async () => 'available',
    create: async () => ({
      promptStreaming: async function* () { yield 'ok'; },
      destroy: () => { destroyed += 1; },
    }),
  };
  const client = new ChromeModelClient({ LanguageModel: LM });
  client.ready = true;
  // No onToken passed (compact-style calls): the default must not throw.
  assert.equal(await client.generate([{ role: 'user', content: 'x' }], []), 'ok');
  assert.equal(destroyed, 1, 'destroyed after a successful turn');
  const LM2 = {
    availability: async () => 'available',
    create: async () => ({
      promptStreaming: async function* () { const e = new Error('boom'); e.name = 'TypeError'; throw e; },
      destroy: () => { destroyed += 1; },
    }),
  };
  const failing = new ChromeModelClient({ LanguageModel: LM2 });
  failing.ready = true;
  await assert.rejects(failing.generate([{ role: 'user', content: 'x' }], [], () => {}), /on-device model error/);
  assert.equal(destroyed, 2, 'destroyed after a failed turn too');
});

test('the session offers no tool schemas to a backend without tool calling', async () => {
  const calls = [];
  const client = { ready: true, supportsTools: false, count: () => Promise.resolve(1), generate: (messages, schemas) => { calls.push(schemas.length); return 'On-device answer.'; }, stop: () => {} };
  const session = new AgentSession({ client, store: { save: async () => {} }, webSearch: async () => ({}), httpGet: async () => ({}), runJavaScript: async () => ({}), emit: () => {} });
  await session.send('hello');
  assert.equal(calls.length, 1);
  assert.equal(calls[0], 0, 'no tool schemas are sent to the on-device model');
  assert.equal(session.history.at(-1).content, 'On-device answer.');
});

// Fix round 1: a tool is offered only when its API reports 'available' — a model-initiated create()
// has no user gesture to start Chrome's own download (which the Settings download buttons provide).
test('tool gating: downloadable or unavailable APIs offer no tool; available ones do', () => {
  assert.deepEqual(chromeToolGates({ languageModel: 'available', translator: 'downloadable', summarizer: 'downloadable', detector: 'unavailable' }),
    { translate: false, summarize: false, detectLanguage: false }, 'downloadable offers no tool');
  assert.deepEqual(chromeToolGates({ languageModel: 'available', translator: 'available', summarizer: 'available', detector: 'available' }),
    { translate: true, summarize: true, detectLanguage: true }, 'available offers the tool');
  assert.deepEqual(chromeToolGates({ languageModel: 'downloadable', translator: 'unavailable', summarizer: 'downloading', detector: 'unavailable' }),
    { translate: false, summarize: false, detectLanguage: false }, 'unavailable and downloading offer no tool');
});

test('chromeDownload calls each API create() with the documented options and reports progress', async () => {
  const calls = []; const mk = (label) => ({ create: async (opts) => { calls.push([label, opts]); opts.monitor?.({ addEventListener: (t, f) => { if (t === 'downloadprogress') f({ loaded: 0.42 }); } }); } });
  const scope = { Translator: mk('translator'), Summarizer: mk('summarizer'), LanguageDetector: mk('detector') };
  const statuses = [];
  await chromeDownload(scope, 'translate', (t) => statuses.push(t));
  await chromeDownload(scope, 'summarize', (t) => statuses.push(t));
  await chromeDownload(scope, 'detectLanguage', (t) => statuses.push(t));
  assert.equal(calls.length, 3);
  assert.equal(calls[0][0], 'translator');
  assert.equal(calls[0][1].sourceLanguage, 'en'); assert.equal(calls[0][1].targetLanguage, 'fr'); assert.equal(typeof calls[0][1].monitor, 'function');
  assert.equal(calls[1][0], 'summarizer'); assert.equal(calls[1][1].type, 'key-points'); assert.equal(typeof calls[1][1].monitor, 'function');
  assert.equal(calls[2][0], 'detector'); assert.equal(typeof calls[2][1].monitor, 'function');
  assert.ok(statuses.some((s) => s.includes('42%')), 'the documented monitor progress reaches the status line');
  await assert.rejects(chromeDownload({ Translator: null }, 'translate', () => {}), /not supported/);
});

test('a failed on-device tool call (e.g. a NotAllowedError race) returns a clear error pointing at the Settings button', async () => {
  const race = new Error('User activation is required'); race.name = 'NotAllowedError';
  const failing = { create: async () => { throw race; } };
  const e = chromeExecutors({ Translator: failing, Summarizer: failing, LanguageDetector: failing }, () => {});
  const t = (await e.translate('bonjour', 'fr', 'en')); assert.ok(t.error, 'the failure is a tool_result, not a throw');
  assert.match(t.error, /Settings/, 'the error tells the model to suggest the Settings area');
  assert.match(t.error, /Download Translator model/, 'the error names the exact Settings button');
  assert.match((await e.summarize('text', 'tldr')).error, /Download Summarizer model/);
  assert.match((await e.detectLanguage('Hallo')).error, /Download Language detector model/);
});
