import { setupApp } from './common.mjs';
const frame = document.querySelector('#excalidraw-frame');
const loading = document.querySelector('#excalidraw-loading');
const status = document.querySelector('#excalidraw-status');
const retry = document.querySelector('#excalidraw-retry');
let poll, timeout;
function failed() { clearInterval(poll); clearTimeout(timeout); loading.hidden = false; status.textContent = 'Excalidraw could not load. Retry or open the full page.'; retry.hidden = false; }
// The app exposes webpcExcalidraw.flush() once ready; it writes the debounced autosave now.
// Before readiness there is nothing newer than what is already stored, so a missing flush is fine.
const flush = () => { try { frame.contentWindow?.webpcExcalidraw?.flush?.(); } catch { /* storage errors surface inside the app */ } };
// WebPC close hook: desktop.js calls this before hiding the window. Flush the pending save,
// then let the close proceed (the stored scene is the recovery path either way).
window.pcBeforeClose = () => { flush(); return true; };
window.addEventListener('pagehide', flush);
function monitor() {
  clearInterval(poll); clearTimeout(timeout);
  poll = setInterval(() => {
    try {
      const doc = frame.contentDocument;
      if (!doc || /404|not found/i.test(doc.title)) return;
      if (!frame.contentWindow?.webpcExcalidraw) return;
      clearInterval(poll); clearTimeout(timeout); loading.hidden = true;
      doc.addEventListener('pointerdown', () => parent.postMessage({ type: 'pc:focus', appId: 'excalidraw' }, location.origin), true);
      setupApp('excalidraw');
    } catch { failed(); }
  }, 150);
  timeout = setTimeout(failed, 45000);
}
retry.addEventListener('click', () => { retry.hidden = true; status.textContent = 'Loading Excalidraw…'; frame.src = frame.src; monitor(); });
frame.addEventListener('error', failed);
monitor();
