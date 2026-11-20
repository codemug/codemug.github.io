// WebPC Excalidraw entry: mounts <Excalidraw/> full-window, fully local — no collaboration
// props, no onExportToBackend. The scene autosaves (debounced) to the WebPC-namespaced key,
// follows the desktop's pc:theme message, and exposes window.webpcExcalidraw { flush, api }
// so the WebPC wrapper can flush the pending save when its window closes.
import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Excalidraw } from '@excalidraw/excalidraw';
import { readScene, writeScene, quarantineUnreadable, serializeScene, SCENE_KEY } from './storage.mjs';

const DEBOUNCE_MS = 1000;
// Fixed overlay so a storage note never pushes the editor (sized to the viewport) out of the
// 100vh root; the editor's own CSS leaves the note's position to us.
const NOTE_STYLE = {
  position: 'fixed',
  top: 0,
  left: 0,
  right: 0,
  zIndex: 1000000,
  margin: 0,
  padding: '8px 12px',
  fontSize: '13px',
  lineHeight: 1.4,
  background: '#fceeca',
  borderBottom: '1px solid #f3ab2c',
};
let storage, initialData, storageNote, initialTheme = 'light';
// The revision this tab loaded or last wrote, and the serialized scene at the last
// successful write: flushes only write a scene that changed since the last write, and a
// stored scene newer than localRev wins (another tab is ahead).
let localRev = 0;
let lastWritten = null;
try { storage = localStorage; } catch { storage = null; }
try { initialTheme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; } catch {}
if (storage) {
  const { scene, invalid, error } = readScene(storage);
  if (scene) {
    localRev = scene.rev;
    initialData = { elements: scene.elements, appState: scene.appState, files: scene.files };
  } else if (invalid) {
    // The stored copy is unreadable: move it to the backup key before this tab's first
    // autosave can overwrite it.
    if (quarantineUnreadable(storage)) {
      storageNote = 'A previously saved scene could not be read, so a blank canvas was opened. The unreadable copy was moved to pc:excalidraw:scene:v1:unreadable and autosave will write over it now. Use Export to keep important work.';
    } else {
      storageNote = 'A previously saved scene could not be read or moved to a backup, so a blank canvas was opened and the stored copy will be replaced by the next change. Use Export to keep important work.';
    }
  } else if (error) storageNote = 'Browser storage is unavailable, so your scene will not be saved automatically. Use Export to keep your work.';
} else storageNote = 'Browser storage is unavailable, so your scene will not be saved automatically. Use Export to keep your work.';

function App() {
  const [theme, setTheme] = useState(initialTheme);
  const [saveError, setSaveError] = useState(false);
  const [tooLarge, setTooLarge] = useState(false);
  const [changedElsewhere, setChangedElsewhere] = useState(false);
  const latest = useRef(null);
  const timer = useRef(null);
  const flush = () => {
    clearTimeout(timer.current);
    if (!latest.current) return true;
    if (!storage) return false;
    // Unchanged since the last write (a re-flush from pagehide or the desktop close):
    // skip — an unconditional rewrite here could clobber newer work from another tab.
    const serialized = serializeScene(latest.current);
    if (serialized === lastWritten) return true;
    const result = writeScene(storage, latest.current, localRev);
    if (result === 'ok') {
      lastWritten = serialized;
      localRev += 1;
      setSaveError(false); setTooLarge(false); setChangedElsewhere(false);
      return true;
    }
    if (result === 'too-large') { setTooLarge(true); return false; }
    if (result === 'conflict') { setChangedElsewhere(true); return false; }
    setSaveError(true);
    return false;
  };
  useEffect(() => {
    const onTheme = event => {
      if (event.source !== window.parent) return; // only the WebPC wrapper may set the theme
      if (event.origin === location.origin && event.data?.type === 'pc:theme' && ['dark', 'light'].includes(event.data.theme)) setTheme(event.data.theme);
    };
    const onStorage = event => {
      if (event.key !== SCENE_KEY || !storage) return; // fired by another tab's write to our key
      const { scene } = readScene(storage);
      if (scene && scene.rev > localRev) setChangedElsewhere(true); // another tab is ahead of this one
    };
    window.addEventListener('message', onTheme);
    window.addEventListener('pagehide', flush);
    window.addEventListener('storage', onStorage);
    return () => { window.removeEventListener('message', onTheme); window.removeEventListener('pagehide', flush); window.removeEventListener('storage', onStorage); };
  }, []);
  const note = changedElsewhere
    ? 'This drawing changed in another tab; reopen Excalidraw to load it.'
    : tooLarge
      ? 'This drawing is too large for the local autosave limit; the stored copy is unchanged. Use Save to file to keep it.'
      : saveError
        ? 'Local save failed (storage full or blocked). Export to keep your work; the stored copy is unchanged.'
        : storageNote;
  return (
    <div className="webpc-excalidraw" style={{ height: '100%' }}>
      {note && <div className="webpc-excalidraw-note" style={NOTE_STYLE} role="alert">{note}</div>}
      <Excalidraw
        theme={theme}
        initialData={initialData}
        onChange={(elements, appState, files) => { latest.current = { elements, appState, files }; clearTimeout(timer.current); timer.current = setTimeout(flush, DEBOUNCE_MS); }}
        excalidrawAPI={api => { window.webpcExcalidraw = { flush, api }; }}
      />
    </div>
  );
}

createRoot(document.getElementById('excalidraw-root')).render(<App />);
