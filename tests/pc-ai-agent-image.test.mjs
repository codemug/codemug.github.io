// Unit tests for AI-1 image input: boundary validation, the worker message builder (image part),
// and persistence stripping (pixels are never stored). Run: node --test tests/pc-ai-agent-image.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkImage, imageMarker, stripImages, IMAGE_MAX_BYTES, IMAGE_MAX_SIDE } from '../src/apps/ai-agent/agent.js';
import { validateConversation } from '../src/apps/ai-agent/storage.js';
import { AgentSession } from '../src/apps/ai-agent/session.js';
import { MODELS } from '../src/apps/ai-agent/models.js';

const file = (type, size) => ({ type, size, name: 'x.png' });

test('image validation: only png/jpeg/webp, at most 10 MB', () => {
  assert.equal(checkImage(file('image/png', 1)), null);
  assert.equal(checkImage(file('image/jpeg', IMAGE_MAX_BYTES)), null); // exactly 10 MB passes
  assert.equal(checkImage(file('image/webp', IMAGE_MAX_BYTES)), null);
  assert.ok(checkImage(file('image/webp', IMAGE_MAX_BYTES + 1)));
  assert.ok(checkImage(file('image/gif', 100)));
  assert.ok(checkImage(file('image/svg+xml', 100)));
  assert.ok(checkImage(file('', 100)));
  assert.ok(checkImage(null));
  assert.equal(IMAGE_MAX_SIDE, 768);
});

test('image marker is plain text with name and dimensions', () => {
  assert.equal(imageMarker({ name: 'photo.png', width: 640, height: 480 }), '[image: photo.png, 640×480]');
});

test('stripImages removes payloads but leaves the marker and history intact', () => {
  const hist = [
    { role: 'user', content: '[image: a.png, 4×4] hi', image: { name: 'a.png', width: 4, height: 4, data: new Uint8Array(64) } },
    { role: 'assistant', content: 'yo' },
  ];
  const stripped = stripImages(hist);
  assert.ok(!('image' in stripped[0]));
  assert.equal(stripped[0].content, '[image: a.png, 4×4] hi');
  assert.deepEqual(stripped[1], hist[1]);
  assert.ok('image' in hist[0]); // the in-memory history keeps the pixels
});

test('the save boundary (validateConversation) strips image payloads', () => {
  const value = {
    history: [
      { role: 'user', content: '[image: a.png, 4×4] hi', image: { name: 'a.png', width: 4, height: 4, data: new Uint8Array(64) } },
      { role: 'assistant', content: 'ok' },
    ],
    summary: '',
  };
  const saved = validateConversation(value);
  assert.ok(!('image' in saved.history[0]));
  assert.equal(saved.history[0].content, '[image: a.png, 4×4] hi');
  assert.ok(!('image' in saved.history[1]));
  // Existing records without image fields pass through untouched.
  const legacy = validateConversation({ history: [{ role: 'user', content: 'old text' }], summary: '' });
  assert.deepEqual(legacy.history, [{ role: 'user', content: 'old text' }]);
});

function setup() {
  const saved = [];
  let generateArgs = null;
  const client = {
    ready: true, vision: true, stop() {},
    count: async () => 100,
    generate: async (messages) => (generateArgs = messages, 'A red circle.'),
  };
  const store = { save: async (value) => saved.push(structuredClone(value)) };
  const session = new AgentSession({ client, store, webSearch: async () => ({ results: [] }), httpGet: async () => ({}), runJavaScript: async () => ({ result: 1 }), emit: () => {} });
  return { session, saved, getArgs: () => generateArgs };
}

test('the worker message for an image turn carries the image part, then the marker text', async () => {
  const { session, getArgs } = setup();
  const image = { name: 'photo.png', width: 64, height: 32, data: new Uint8Array(64 * 32 * 4).fill(7) };
  await session.send('what is this?', image);
  const messages = getArgs();
  assert.equal(messages[0].role, 'system');
  const user = messages.findLast((m) => m.role === 'user');
  assert.equal(user.content[0].type, 'image');
  assert.equal(user.content[0].image.width, 64);
  assert.equal(user.content[0].image.data.length, 64 * 32 * 4);
  assert.equal(user.content[1].type, 'text');
  assert.ok(user.content[1].text.includes('[image: photo.png, 64×32]'));
  assert.ok(user.content[1].text.endsWith('what is this?'));
  // The in-memory history keeps the pixels for follow-up turns (prompt() re-sends them each turn).
  const inMemory = session.history.find((m) => m.role === 'user');
  assert.ok(inMemory.image.data instanceof Uint8Array);
  const reprompted = session.prompt().findLast((m) => m.role === 'user');
  assert.equal(reprompted.content[0].type, 'image');
});

test('the stored snapshot after an image turn has no payload, only the marker', async () => {
  const { session, saved } = setup();
  const image = { name: 'chart.png', width: 8, height: 8, data: new Uint8Array(8 * 8 * 4) };
  await session.send('read this chart', image);
  const snapshot = saved.at(-1);
  const user = snapshot.history.find((m) => m.role === 'user');
  assert.ok(!('image' in user), 'no image payload in the saved record');
  assert.ok(user.content.includes('[image: chart.png, 8×8]'));
  assert.ok(user.content.endsWith('read this chart'));
  assert.equal(typeof user.content, 'string');
  // Export (same snapshot path) is also payload-free.
  assert.ok(!('image' in session.snapshot().history.find((m) => m.role === 'user')));
});

test('LFM3 has no vision metadata; Qwen models carry the on-demand encoder size', () => {
  assert.equal(MODELS['lfm3-1.7b'].vision, undefined);
  assert.equal(MODELS['qwen3.5-0.8b'].vision.size, '~62 MB');
  assert.equal(MODELS['qwen3.5-2b'].vision.size, '~197 MB');
});
