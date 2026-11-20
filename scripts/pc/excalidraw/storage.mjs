// WebPC Excalidraw scene persistence: pure serialize/validate helpers (unit-tested in
// tests/pc-excalidraw.test.mjs) plus thin localStorage wrappers. This mirror lives under a
// WebPC-namespaced key; Excalidraw's own "Save to browser" keeps a separate copy under its own.
export const SCENE_KEY = 'pc:excalidraw:scene:v1';
// An unreadable stored scene is moved here (before this tab's first write can overwrite
// it) instead of being silently replaced.
export const UNREADABLE_KEY = 'pc:excalidraw:scene:v1:unreadable';
const MAX_SCENE_BYTES = 4_500_000;
// View state worth restoring; the rest of appState is per-session tool state.
const APP_STATE_FIELDS = ['scrollX', 'scrollY', 'zoom', 'viewBackgroundColor', 'canvasBackground', 'gridSize', 'viewModeEnabled'];
const isPlainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export function serializeScene({ elements, appState, files }, rev = 0) {
  const state = {};
  for (const key of APP_STATE_FIELDS) if (isPlainObject(appState) && typeof appState[key] !== 'undefined') state[key] = appState[key];
  return JSON.stringify({ v: 1, rev, elements, appState: state, files: isPlainObject(files) ? files : {} });
}

// Corrupt (bad JSON, wrong version tag) or foreign (another app's shape) data must never reach
// Excalidraw: return a clean scene or null. string.length is UTF-16 units — a conservative
// quota guard, not a byte count. rev is the stored revision (scenes written before
// revisions existed count as 0).
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
  const rev = Number.isInteger(data.rev) && data.rev >= 0 ? data.rev : 0;
  return { elements: data.elements, appState, files, rev };
}

export function readScene(storage) {
  try {
    const text = storage.getItem(SCENE_KEY);
    if (!text) return { scene: null, invalid: false, error: null };
    const scene = validateScene(text);
    return { scene, invalid: scene === null, error: null };
  } catch (error) { return { scene: null, invalid: false, error }; }
}

// Move an unreadable stored scene to the backup key. Call before the first write so the
// corrupt bytes survive somewhere. Returns true when a move happened.
export function quarantineUnreadable(storage) {
  try {
    const text = storage.getItem(SCENE_KEY);
    if (text === null) return false;
    storage.setItem(UNREADABLE_KEY, text);
    storage.removeItem(SCENE_KEY);
    return true;
  } catch { return false; }
}

// writeScene returns 'ok', 'too-large' (the same limit readScene enforces — never write
// what a read would reject), 'conflict' (the stored revision is newer than the one this
// tab loaded or last wrote — the stored copy is left untouched), or 'error' (storage
// blocked or full).
export function writeScene(storage, scene, expectedRev = 0) {
  const text = serializeScene(scene, expectedRev + 1);
  if (text.length > MAX_SCENE_BYTES) return 'too-large';
  let storedRev = 0;
  try {
    const current = storage.getItem(SCENE_KEY);
    if (current) {
      const parsed = validateScene(current);
      storedRev = parsed ? parsed.rev : 0;
    }
  } catch { return 'error'; }
  if (storedRev > expectedRev) return 'conflict';
  try { storage.setItem(SCENE_KEY, text); return 'ok'; } catch { return 'error'; }
}
