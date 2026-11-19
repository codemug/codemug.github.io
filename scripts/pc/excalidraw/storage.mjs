// WebPC Excalidraw scene persistence: pure serialize/validate helpers (unit-tested in
// tests/pc-excalidraw.test.mjs) plus thin localStorage wrappers. This mirror lives under a
// WebPC-namespaced key; Excalidraw's own "Save to browser" keeps a separate copy under its own.
export const SCENE_KEY = 'pc:excalidraw:scene:v1';
const MAX_SCENE_BYTES = 4_500_000;
// View state worth restoring; the rest of appState is per-session tool state.
const APP_STATE_FIELDS = ['scrollX', 'scrollY', 'zoom', 'viewBackgroundColor', 'canvasBackground', 'gridSize', 'viewModeEnabled'];
const isPlainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export function serializeScene({ elements, appState, files }) {
  const state = {};
  for (const key of APP_STATE_FIELDS) if (isPlainObject(appState) && typeof appState[key] !== 'undefined') state[key] = appState[key];
  return JSON.stringify({ v: 1, elements, appState: state, files: isPlainObject(files) ? files : {} });
}

// Corrupt (bad JSON, wrong version tag) or foreign (another app's shape) data must never reach
// Excalidraw: return a clean scene or null. string.length is UTF-16 units — a conservative
// quota guard, not a byte count.
export function validateScene(text) {
  if (typeof text !== 'string' || !text || text.length > MAX_SCENE_BYTES) return null;
  let data;
  try { data = JSON.parse(text); } catch { return null; }
  if (!isPlainObject(data) || data.v !== 1 || !Array.isArray(data.elements)) return null;
  for (const element of data.elements) if (!isPlainObject(element) || typeof element.id !== 'string' || typeof element.type !== 'string') return null;
  const appState = data.appState === undefined ? {} : data.appState;
  if (!isPlainObject(appState)) return null;
  const files = data.files === undefined ? {} : data.files;
  if (!isPlainObject(files)) return null;
  for (const file of Object.values(files)) if (!isPlainObject(file) || typeof file.id !== 'string') return null;
  return { elements: data.elements, appState, files };
}

export function readScene(storage) {
  try {
    const text = storage.getItem(SCENE_KEY);
    if (!text) return { scene: null, invalid: false, error: null };
    const scene = validateScene(text);
    return { scene, invalid: scene === null, error: null };
  } catch (error) { return { scene: null, invalid: false, error }; }
}

export function writeScene(storage, scene) {
  try { storage.setItem(SCENE_KEY, serializeScene(scene)); return true; } catch { return false; }
}
