// Unit tests for AI-5: cloud tool-schema mapping, tool-input validation, SSE parsing,
// image blocks, provider message mapping and the key-privacy guarantee (memory only).
// Run: node --test tests/pc-ai-agent-cloud.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTools, toolSchemas, validateToolInput } from '../src/apps/ai-agent/agent.js';
import { anthropicToolDefinitions, parseSSE, anthropicImageBlock, openAIImagePart, refusalNotice, estimateTokens, dataUrlBytes } from '../src/apps/ai-agent/cloud.js';
import { CloudClient, anthropicMapping, openAIMapping } from '../src/apps/ai-agent/cloud-client.js';
import { AgentSession, systemPrompt } from '../src/apps/ai-agent/session.js';
import { validateConversation } from '../src/apps/ai-agent/storage.js';

const tools = createTools({ webSearch: async () => ({ results: [] }), httpGet: async () => ({ content: 'p' }), runJavaScript: async () => ({ result: 42 }), allowedHosts: () => new Set(['en.wikipedia.org']) });
const schemas = toolSchemas(tools);

test('anthropic tool definitions are strict, closed schemas with eager input streaming', () => {
  const defs = anthropicToolDefinitions(schemas);
  assert.equal(defs.length, 4);
  const calc = defs.find((d) => d.name === 'calculate');
  assert.equal(calc.strict, true);
  assert.equal(calc.eager_input_streaming, true);
  assert.deepEqual(calc.input_schema.required, ['expression']);
  assert.equal(calc.input_schema.additionalProperties, false);
  assert.deepEqual(calc.input_schema.properties, tools.calculate.parameters.properties);
});

test('tool input validation rejects missing, extra and mistyped fields', () => {
  const parameters = tools.calculate.parameters;
  assert.equal(validateToolInput(parameters, { expression: '6*7' }).ok, true);
  assert.match(validateToolInput(parameters, {}).error, /Missing required field "expression"/);
  assert.match(validateToolInput(parameters, { expression: '6*7', extra: 1 }).error, /Unexpected field "extra"/);
  assert.match(validateToolInput(parameters, { expression: 7 }).error, /must be string/);
  assert.equal(validateToolInput({ properties: {} }, 'nope').ok, false);
});

const sseStream = (pieces) => new Response(new ReadableStream({
  start(controller) { for (const piece of pieces) controller.enqueue(new TextEncoder().encode(piece)); controller.close(); },
}));

test('SSE parsing: streamed text, fragmented tool-call arguments, [DONE] and split lines', async () => {
  const streamed = [];
  const piece = (o) => `data: ${JSON.stringify(o)}\n\n`;
  const toolChunk = piece({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_9', function: { name: 'calc', arguments: '{"ex' } }] } }] });
  const toolChunk2 = piece({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'pression":"6*7"}' } }] } }] });
  const cut = 40; // split one data line across two stream chunks
  const response = sseStream([
    piece({ choices: [{ delta: { role: 'assistant' } }] }),
    piece({ choices: [{ delta: { content: 'Hel' } }] }) + 'da',
    `ta: ${JSON.stringify({ choices: [{ delta: { content: 'lo' } }] })}\n\n`,
    toolChunk.slice(0, cut),
    toolChunk.slice(cut) + toolChunk2,
    'data: [DONE]\n\n',
  ]);
  const { text, toolCalls } = await parseSSE(response.body, (piece) => streamed.push(piece));
  assert.equal(text, 'Hello');
  assert.deepEqual(streamed, ['Hel', 'lo']);
  assert.equal(toolCalls.length, 1);
  // Provider tool-call ids are dropped on purpose: the session assigns its own record ids, which it reuses in the next request.
  assert.equal(toolCalls[0].name, 'calc');
  assert.deepEqual(toolCalls[0].arguments, { expression: '6*7' });
});

test('image blocks: Anthropic base64 source and OpenAI data URL', () => {
  const image = { name: 'p.png', width: 1, height: 1, type: 'image/png', data: new Uint8Array([0x89, 0x50, 0x4e, 0x47]) };
  const b64 = Buffer.from(image.data).toString('base64');
  assert.deepEqual(anthropicImageBlock(image), { type: 'image', source: { type: 'base64', media_type: 'image/png', data: b64 } });
  assert.deepEqual(openAIImagePart(image), { type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } });
});

test('cloud image turns send the PNG bytes decoded from the data URL, not raw RGBA pixels', () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const attached = { name: 'p.jpeg', width: 1, height: 1, type: 'image/jpeg', data: new Uint8Array([1, 2, 3]), url: `data:image/png;base64,${Buffer.from(png).toString('base64')}` };
  const pngBytes = dataUrlBytes(attached.url);
  assert.deepEqual([...pngBytes], [...png], 'the decode returns the PNG bytes');
  // What the app sends to the cloud: those bytes, labelled image/png regardless of the source file type.
  const sent = { name: attached.name, width: attached.width, height: attached.height, data: pngBytes, type: 'image/png' };
  assert.deepEqual(anthropicImageBlock(sent), { type: 'image', source: { type: 'base64', media_type: 'image/png', data: Buffer.from(png).toString('base64') } });
  assert.throws(() => dataUrlBytes('https://x.example/a.png'), /base64 data URL/);
  assert.throws(() => dataUrlBytes('data:text/plain,abc'), /base64 data URL/);
});

test('anthropic mapping: system out, tool_use blocks, tool results merged into one user message', () => {
  const { system, messages } = anthropicMapping([
    { role: 'system', content: 'SYS' },
    { role: 'user', content: 'hi' },
    { role: 'assistant', content: 'checking', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'calculate', arguments: { expression: '6*7' } } }] },
    { role: 'tool', tool_call_id: 'c1', content: JSON.stringify({ result: 42 }) },
    { role: 'assistant', content: 'The answer is 42.' },
  ]);
  assert.equal(system, 'SYS');
  assert.deepEqual(messages[0], { role: 'user', content: 'hi' });
  assert.deepEqual(messages[1], { role: 'assistant', content: [{ type: 'text', text: 'checking' }, { type: 'tool_use', id: 'c1', name: 'calculate', input: { expression: '6*7' } }] });
  assert.deepEqual(messages[2], { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'c1', content: JSON.stringify({ result: 42 }), is_error: false }] });
  assert.deepEqual(messages[3], { role: 'assistant', content: [{ type: 'text', text: 'The answer is 42.' }] });
  const errorMapping = anthropicMapping([{ role: 'tool', tool_call_id: 'c1', content: JSON.stringify({ error: 'boom' }) }]);
  assert.equal(errorMapping.messages[0].content[0].is_error, true);
});

test('openai mapping: system role, assistant tool_calls with JSON-string arguments, tool role', () => {
  const { messages } = openAIMapping([
    { role: 'system', content: 'SYS' },
    { role: 'assistant', content: 'checking', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'calculate', arguments: { expression: '6*7' } } }] },
    { role: 'tool', tool_call_id: 'c1', content: 'R' },
    { role: 'user', content: [{ type: 'image', image: { name: 'p.png', width: 1, height: 1, type: 'image/png', data: new Uint8Array([1]) } }, { type: 'text', text: 'describe' }] },
  ]);
  assert.deepEqual(messages[0], { role: 'system', content: 'SYS' });
  assert.deepEqual(messages[1].tool_calls, [{ id: 'c1', type: 'function', function: { name: 'calculate', arguments: '{"expression":"6*7"}' } }]);
  assert.deepEqual(messages[2], { role: 'tool', tool_call_id: 'c1', content: 'R' });
  assert.equal(messages[3].content[0].type, 'image_url');
  assert.ok(messages[3].content[0].image_url.url.startsWith('data:image/png;base64,'));
});

test('refusal notice keeps the category and explanation visible', () => {
  assert.equal(refusalNotice({ category: 'cyber', explanation: 'Could enable harm.' }), 'Claude refused this request (category: cyber). Could enable harm. Nothing was sent to a tool.');
  assert.ok(refusalNotice({}).includes('category: unknown'));
});

test('system prompt opening depends on the active backend; the rest of the prompt is identical', () => {
  const local = systemPrompt({ ready: true });
  const cloud = systemPrompt({ host: 'api.anthropic.com' });
  assert.ok(local.startsWith("You are AI Agent, a helpful text assistant running locally in the user's browser. Be accurate and concise."));
  assert.ok(cloud.startsWith("You are AI Agent, a helpful assistant inside WebPC, running on api.anthropic.com with the user's own API key; messages and tool results are sent to that provider. Be accurate and concise."));
  const rest = (s) => s.slice(s.indexOf('Be accurate and concise.'));
  assert.equal(rest(cloud), rest(local), 'only the opening line may differ');
  assert.ok(local.endsWith('If a tool cannot help, explain the limitation.'));
  assert.ok(local.includes('web_search searches Wikipedia only'), 'sentinel from the unchanged tail');
  assert.equal(systemPrompt({ host: '' }), systemPrompt({}), 'an unconfirmed cloud client is not claimed as a provider');
});

const openAISSE = (delta) => `data: ${JSON.stringify({ choices: [{ delta }] })}\n\ndata: [DONE]\n\n`;
const cloudTurn = (fetcher) => {
  const saved = [];
  const session = new AgentSession({
    client: fetcher.cloud, store: { save: async (value) => saved.push(structuredClone(value)) },
    webSearch: async () => ({ results: [] }), httpGet: async () => ({}), runJavaScript: async () => ({ result: 42 }), emit: () => {},
  });
  return { session, saved };
};

test('cloud turn: key travels in the header only, never in the snapshot or export', async () => {
  const requests = [];
  const fetcher = async (url, init) => {
    requests.push({ url, init });
    return sseStream([openAISSE({ content: '42' })]);
  };
  const cloud = new CloudClient({ fetch: fetcher });
  cloud.configure({ provider: 'openai', model: 'gpt-test', baseUrl: 'https://llm.example.test/v1', key: 'sk-test-SECRET-123' });
  const { session, saved } = cloudTurn({ cloud });
  await session.send('calculate 6*7');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://llm.example.test/v1/chat/completions', 'the base URL path must be kept (dropping it 404s)');
  assert.match(requests[0].init.headers.authorization, /^Bearer sk-test-SECRET-123$/);
  const body = JSON.parse(requests[0].init.body);
  assert.equal(body.model, 'gpt-test'); assert.equal(body.stream, true); assert.equal(body.tool_choice, 'auto');
  assert.equal(body.tools.length, 4);
  const snapshot = session.snapshot();
  const exported = { version: 1, ...snapshot, savedAt: 1 };
  for (const value of [snapshot, exported, ...saved, validateConversation(snapshot)]) {
    assert.ok(!JSON.stringify(value).includes('sk-test-SECRET-123'), 'the key must never be persisted or exported');
  }
});

test('cloud tool round-trip keeps the provider tool-call id and stops on the final answer', async () => {
  const requests = [];
  const fetcher = async (url, init) => {
    requests.push(JSON.parse(init.body));
    return requests.length === 1
      ? sseStream([openAISSE({ role: 'assistant' }), openAISSE({ tool_calls: [{ index: 0, id: 'call_x', function: { name: 'calculate', arguments: '{"expression":"6*7"}' } }] }), openAISSE({})])
      : sseStream([openAISSE({ content: 'The product is 42.' })]);
  };
  const cloud = new CloudClient({ fetch: fetcher });
  cloud.configure({ provider: 'openai', model: 'gpt-test', baseUrl: 'https://llm.example.test', key: 'sk-test' });
  const schemas = toolSchemas(createTools({ webSearch: async () => ({ results: [] }), httpGet: async () => ({}), runJavaScript: async () => ({ result: 42 }), allowedHosts: () => new Set() }));
  const prompt = [{ role: 'system', content: 'SYS' }, { role: 'user', content: 'calculate 6*7' }];
  const first = await cloud.generate(prompt, schemas, () => {});
  assert.equal(first.text, '');
  // Provider tool-call ids are not needed: the session assigns its own record ids and reuses them in the next request.
  assert.deepEqual(first.toolCalls, [{ name: 'calculate', arguments: { expression: '6*7' } }]);
  const turn = [...prompt, { role: 'assistant', content: '', tool_calls: [{ id: 'call_x', type: 'function', function: { name: 'calculate', arguments: { expression: '6*7' } } }] }, { role: 'tool', tool_call_id: 'call_x', content: JSON.stringify({ result: 42 }) }];
  const second = await cloud.generate(turn, [], () => {});
  assert.equal(second.text, 'The product is 42.');
  assert.equal(second.toolCalls.length, 0);
  assert.equal(requests[1].messages[2].tool_calls[0].id, 'call_x');
  assert.equal(requests[1].messages[3].role, 'tool');
  assert.equal(requests[1].messages[3].tool_call_id, 'call_x');
  assert.ok(!('tools' in requests[1]), 'no tools offered on the final round');
});

test('an OpenAI-compatible base URL keeps its path, with or without a trailing slash', async () => {
  const requests = [];
  const fetcher = async (url) => { requests.push(url); return sseStream([openAISSE({ content: 'ok' })]); };
  for (const [baseUrl, expected] of [
    ['https://api.openai.com/v1', 'https://api.openai.com/v1/chat/completions'],
    ['https://llm.example.test/custom/v1/', 'https://llm.example.test/custom/v1/chat/completions'],
    ['https://llm.example.test', 'https://llm.example.test/chat/completions'],
  ]) {
    const cloud = new CloudClient({ fetch: fetcher });
    cloud.configure({ provider: 'openai', model: 'm', baseUrl, key: 'k' });
    await cloud.generate([{ role: 'user', content: 'hi' }], []);
    assert.equal(requests.at(-1), expected, `base URL ${baseUrl}`);
  }
});

test('stop() aborts the OpenAI stream while the body is still being read', async () => {
  let signal;
  const fetcher = (url, init) => {
    signal = init.signal;
    // A body that only ends when the fetch signal aborts (like a slow SSE stream).
    return new Response(new ReadableStream({
      pull: () => new Promise((_, reject) => { signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }); }),
    }), { status: 200, headers: { 'content-type': 'text/event-stream' } });
  };
  const cloud = new CloudClient({ fetch: fetcher });
  cloud.configure({ provider: 'openai', model: 'm', baseUrl: 'https://llm.example.test', key: 'k' });
  const pending = cloud.generate([{ role: 'user', content: 'hi' }], []);
  await new Promise((r) => setTimeout(r, 20)); // headers arrived; the body read is in flight
  assert.ok(cloud.active, 'the AbortController must survive past the headers (stop() needs it)');
  cloud.stop();
  await assert.rejects(pending, (e) => e.name === 'AbortError' && e.message === 'Stopped');
});

test('anthropic streaming passes the SDK text delta to onToken (never undefined), and generate works without onToken', async () => {
  const tokens = [];
  const fakeSdk = {
    Anthropic: class {
      beta = { messages: { stream: () => ({
        on: (event, cb) => { if (event === 'text') cb('part1 '); }, // SDK text event: (textDelta, textSnapshot)
        finalMessage: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'part1 ' }] }),
      }) } }
    },
    APIError: class extends Error {}, APIConnectionError: class extends Error {}, APIUserAbortError: class extends Error {},
    AuthenticationError: class extends Error {}, RateLimitError: class extends Error {},
  };
  const cloud = new CloudClient({ fetch: async () => new Response(null), loadSdk: async () => fakeSdk });
  cloud.configure({ provider: 'anthropic', model: 'claude-test', key: 'sk-test' });
  const out = await cloud.generate([{ role: 'user', content: 'hi' }], [], (t) => tokens.push(t));
  assert.deepEqual(tokens, ['part1 '], 'onToken must receive the delta string itself');
  assert.equal(out.text, 'part1 ');
  // compact() and friends call generate without an onToken: the default must not throw.
  const again = await cloud.generate([{ role: 'user', content: 'hi' }], []);
  assert.equal(again.text, 'part1 ');
});

test('configure: https-only base URL, nonempty key and model; clear() forgets the key', async () => {
  const cloud = new CloudClient({ fetch: async () => sseStream([openAISSE({ content: 'x' })]) });
  assert.throws(() => cloud.configure({ provider: 'openai', model: 'm', baseUrl: 'http://plain.example.test', key: 'k' }), /https/);
  assert.throws(() => cloud.configure({ provider: 'openai', model: 'm', baseUrl: 'https://x.example', key: '  ' }), /key/);
  assert.throws(() => cloud.configure({ provider: 'openai', model: '', baseUrl: 'https://x.example', key: 'k' }), /model/);
  const { host } = cloud.configure({ provider: 'anthropic', model: 'claude-opus-5-5', key: 'k' });
  assert.equal(host, 'api.anthropic.com');
  cloud.clear();
  assert.equal(cloud.ready, false);
  assert.equal(cloud.key, null);
  await assert.rejects(cloud.generate([], [], () => {}), /cloud model/i);
  assert.ok(Number.isFinite(await cloud.count([{ role: 'user', content: 'a'.repeat(4) }])));
});

test('estimateTokens is a rough chars/4 with a flat image cost', () => {
  assert.equal(estimateTokens([{ role: 'user', content: 'abcd' }]), 1);
  assert.ok(estimateTokens([{ role: 'user', content: [{ type: 'image', image: {} }, { type: 'text', text: 'x' }] }]) > 100);
});
