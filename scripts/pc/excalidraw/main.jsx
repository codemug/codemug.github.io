// WebPC Excalidraw entry: mounts <Excalidraw/> full-window, fully local — no collaboration
// props, no onExportToBackend. The scene autosaves (debounced) to the WebPC-namespaced key,
// follows the desktop's pc:theme message, and exposes window.webpcExcalidraw { flush, api }
// so the WebPC wrapper can flush the pending save when its window closes.
import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Excalidraw } from '@excalidraw/excalidraw';
import { readScene, writeScene } from './storage.mjs';

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
try { storage = localStorage; } catch { storage = null; }
try { initialTheme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; } catch {}
if (storage) {
  const { scene, invalid, error } = readScene(storage);
  if (scene) initialData = scene;
  else if (invalid) storageNote = 'A previously saved scene could not be read, so a blank canvas was opened and the stored copy was left untouched. Use Export to keep important work.';
  else if (error) storageNote = 'Browser storage is unavailable, so your scene will not be saved automatically. Use Export to keep your work.';
} else storageNote = 'Browser storage is unavailable, so your scene will not be saved automatically. Use Export to keep your work.';

function App() {
  const [theme, setTheme] = useState(initialTheme);
  const [saveError, setSaveError] = useState(false);
  const latest = useRef(null);
  const timer = useRef(null);
  const flush = () => {
    clearTimeout(timer.current);
    if (!latest.current) return true;
    if (!storage) return false;
    const ok = writeScene(storage, latest.current);
    setSaveError(!ok);
    return ok;
  };
  useEffect(() => {
    const onTheme = event => {
      if (event.origin === location.origin && event.data?.type === 'pc:theme' && ['dark', 'light'].includes(event.data.theme)) setTheme(event.data.theme);
    };
    window.addEventListener('message', onTheme);
    window.addEventListener('pagehide', flush);
    return () => { window.removeEventListener('message', onTheme); window.removeEventListener('pagehide', flush); };
  }, []);
  return (
    <div className="webpc-excalidraw" style={{ height: '100%' }}>
      {(storageNote || saveError) && <div className="webpc-excalidraw-note" style={NOTE_STYLE} role="alert">{saveError ? 'Local save failed (storage full or blocked). Export to keep your work; the stored copy is unchanged.' : storageNote}</div>}
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
