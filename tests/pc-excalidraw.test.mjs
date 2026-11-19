import test from 'node:test';
import assert from 'node:assert/strict';
import { SCENE_KEY, serializeScene, validateScene, readScene, writeScene } from '../scripts/pc/excalidraw/storage.mjs';

test('scene key is WebPC-namespaced', () => { assert.equal(SCENE_KEY, 'pc:excalidraw:scene:v1'); });

const scene = {
  elements: [{ id: 'rect', type: 'rectangle', x: 1, y: 2 }],
  appState: { scrollX: 0, scrollY: 0, zoom: 1, viewBackgroundColor: '#ffffff', gridSize: 5, tool: 'dropped' },
  files: { f1: { id: 'f1', mimeType: 'image/png' } },
};
const subset = { scrollX: 0, scrollY: 0, zoom: 1, viewBackgroundColor: '#ffffff', gridSize: 5 };

test('serializeScene keeps a whitelisted appState subset and round-trips through validateScene', () => {
  assert.deepEqual(validateScene(serializeScene(scene)), { elements: scene.elements, appState: subset, files: scene.files });
});

test('validateScene accepts an empty and a minimal scene', () => {
  assert.deepEqual(validateScene('{"v":1,"elements":[]}'), { elements: [], appState: {}, files: {} });
  assert.deepEqual(validateScene(serializeScene({ elements: [], appState: { viewModeEnabled: true }, files: {} })), { elements: [], appState: { viewModeEnabled: true }, files: {} });
});

test('validateScene rejects corrupt and foreign data', () => {
  for (const bad of [
    null, 42, '', 'not json',
    '{"v":1}', '{"v":1,"elements":"nope"}', '{"v":2,"elements":[]}',
    '{"v":1,"elements":[{"id":"x"}]}',
    '{"v":1,"elements":[],"appState":[]}',
    '{"v":1,"elements":[],"files":[]}',
    '{"v":1,"elements":[],"files":{"f":{}}}',
    '{"document":{"name":"another app\'s backup"}}',
    serializeScene(scene) + 'garbage',
  ]) assert.equal(validateScene(bad), null, `must reject: ${JSON.stringify(bad).slice(0, 60)}`);
});

test('validateScene rejects oversized scenes (quota guard)', () => {
  const text = serializeScene({ elements: [{ id: 'big', type: 'text', text: 'x'.repeat(4_600_000) }], appState: {}, files: {} });
  assert.equal(validateScene(text), null);
});

function memoryStorage() {
  const map = new Map();
  return { getItem: key => (map.has(key) ? map.get(key) : null), setItem: (key, value) => map.set(key, String(value)), removeItem: key => map.delete(key) };
}

test('writeScene/readScene round-trip; missing key, blocked storage and quota errors surface', () => {
  const good = memoryStorage();
  assert.equal(writeScene(good, scene), true);
  assert.deepEqual(readScene(good).scene, { elements: scene.elements, appState: subset, files: scene.files });
  assert.deepEqual(readScene(memoryStorage()), { scene: null, invalid: false, error: null });
  const blocked = memoryStorage();
  blocked.getItem = () => { throw new Error('storage blocked'); };
  assert.match(String(readScene(blocked).error), /storage blocked/);
  const corrupt = memoryStorage();
  corrupt.setItem(SCENE_KEY, '{"v":9}');
  assert.deepEqual(readScene(corrupt), { scene: null, invalid: true, error: null });
  const full = { getItem: () => null, setItem: () => { throw new Error('QuotaExceededError'); } };
  assert.equal(writeScene(full, scene), false);
});
