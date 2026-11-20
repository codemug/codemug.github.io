import test from 'node:test';
import assert from 'node:assert/strict';
import { SCENE_KEY, UNREADABLE_KEY, serializeScene, validateScene, readScene, writeScene, quarantineUnreadable } from '../scripts/pc/excalidraw/storage.mjs';

test('scene keys are WebPC-namespaced (scene and unreadable backup)', () => {
  assert.equal(SCENE_KEY, 'pc:excalidraw:scene:v1');
  assert.equal(UNREADABLE_KEY, 'pc:excalidraw:scene:v1:unreadable');
});

const scene = {
  elements: [{ id: 'rect', type: 'rectangle', x: 1, y: 2 }],
  appState: { scrollX: 0, scrollY: 0, zoom: 1, viewBackgroundColor: '#ffffff', gridSize: 5, tool: 'dropped' },
  files: { f1: { id: 'f1', mimeType: 'image/png' } },
};
const subset = { scrollX: 0, scrollY: 0, zoom: 1, viewBackgroundColor: '#ffffff', gridSize: 5 };

test('serializeScene keeps a whitelisted appState subset, stores the revision, and round-trips through validateScene', () => {
  assert.deepEqual(validateScene(serializeScene(scene)), { elements: scene.elements, appState: subset, files: scene.files, rev: 0 });
  assert.deepEqual(validateScene(serializeScene(scene, 7)), { elements: scene.elements, appState: subset, files: scene.files, rev: 7 });
});

test('validateScene accepts an empty and a minimal scene', () => {
  assert.deepEqual(validateScene('{"v":1,"elements":[]}'), { elements: [], appState: {}, files: {}, rev: 0 });
  assert.deepEqual(validateScene(serializeScene({ elements: [], appState: { viewModeEnabled: true }, files: {} })), { elements: [], appState: { viewModeEnabled: true }, files: {}, rev: 0 });
  // Scenes written before revisions existed count as revision 0.
  const legacy = JSON.parse(serializeScene(scene)); delete legacy.rev;
  assert.equal(validateScene(JSON.stringify(legacy)).rev, 0);
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
  assert.equal(writeScene(good, scene), 'ok');
  assert.deepEqual(readScene(good).scene, { elements: scene.elements, appState: subset, files: scene.files, rev: 1 });
  assert.deepEqual(readScene(memoryStorage()), { scene: null, invalid: false, error: null });
  const blocked = memoryStorage();
  blocked.getItem = () => { throw new Error('storage blocked'); };
  assert.match(String(readScene(blocked).error), /storage blocked/);
  const corrupt = memoryStorage();
  corrupt.setItem(SCENE_KEY, '{"v":9}');
  assert.deepEqual(readScene(corrupt), { scene: null, invalid: true, error: null });
  const full = { getItem: () => null, setItem: () => { throw new Error('QuotaExceededError'); } };
  assert.equal(writeScene(full, scene), 'error');
});

// E1: an unreadable stored scene is moved to the backup key (it survives), not left to be
// silently overwritten by the next autosave.
test('quarantineUnreadable moves the unreadable scene to the backup key exactly once', () => {
  const blocked = memoryStorage();
  blocked.setItem(SCENE_KEY, '{corrupt');
  assert.equal(quarantineUnreadable(blocked), true);
  assert.equal(blocked.getItem(UNREADABLE_KEY), '{corrupt');
  assert.equal(blocked.getItem(SCENE_KEY), null, 'the scene key is clear so autosave can start fresh');
  assert.equal(quarantineUnreadable(blocked), false, 'nothing left to move');
  const empty = memoryStorage();
  assert.equal(quarantineUnreadable(empty), false, 'no stored scene: nothing to move');
  const throwing = { getItem: () => { throw new Error('blocked'); }, setItem: () => {}, removeItem: () => {} };
  assert.equal(quarantineUnreadable(throwing), false, 'a failed move surfaces as false, not a throw');
});

// E2: the write path enforces the same size limit as the read path; over it, nothing is
// written.
test('writeScene refuses oversized scenes without writing (same limit as readScene)', () => {
  const big = { elements: [{ id: 'big', type: 'text', text: 'x'.repeat(4_600_000) }], appState: {}, files: {} };
  const store = memoryStorage();
  store.setItem(SCENE_KEY, serializeScene(scene, 3));
  assert.equal(writeScene(store, big, 3), 'too-large');
  assert.equal(store.getItem(SCENE_KEY), serializeScene(scene, 3), 'the stored copy is untouched');
  const overLimit = validateScene(serializeScene(big));
  assert.equal(overLimit, null, 'a read of the same size is rejected too — write and read agree');
});

// E3: revisions. Each write advances the stored revision from the expected one; a write
// based on a stale revision conflicts and leaves the newer stored copy untouched.
test('writeScene advances the revision from the expected one and conflicts on stale writes', () => {
  const store = memoryStorage();
  assert.equal(writeScene(store, scene, 0), 'ok');
  assert.equal(readScene(store).scene.rev, 1);
  assert.equal(writeScene(store, { ...scene, elements: [...scene.elements, { id: 'second', type: 'text', text: 'x' }] }, 1), 'ok');
  assert.equal(readScene(store).scene.rev, 2);
  // A tab that loaded revision 0 (or last wrote it) is behind: no overwrite.
  const stale = memoryStorage();
  stale.setItem(SCENE_KEY, serializeScene(scene, 2));
  assert.equal(writeScene(stale, scene, 0), 'conflict');
  assert.equal(readScene(stale).scene.rev, 2);
  assert.deepEqual(readScene(stale).scene.elements, scene.elements, 'the newer stored copy is left untouched');
  // A concurrent same-revision write by this tab is fine (expectedRev 2 against stored 2).
  assert.equal(writeScene(stale, scene, 2), 'ok');
  assert.equal(readScene(stale).scene.rev, 3);
});

test('writeScene serializes with the revision it will store', () => {
  const text = serializeScene(scene, 5);
  assert.equal(JSON.parse(text).rev, 5);
  assert.notEqual(serializeScene(scene), serializeScene(scene, 1), 'the revision is part of the stored text');
});
