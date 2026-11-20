import { setupApp } from './common.mjs';
const frame = document.querySelector('#nettools-frame');
const loading = document.querySelector('#nettools-loading');
const status = document.querySelector('#nettools-status');
const retry = document.querySelector('#nettools-retry');
let poll, timeout;
function failed() { clearInterval(poll); clearTimeout(timeout); loading.hidden = false; status.textContent = 'Network and Security Tools could not load. Retry or open the full page.'; retry.hidden = false; }
// Theme: the vendor page (same origin) applies pc:theme messages and remembers the choice in
// nettools:theme. This app persists nothing else, so there is nothing to flush on close.
const sendTheme = () => { try { frame.contentWindow?.postMessage({ type: 'pc:theme', theme: document.documentElement.dataset.theme }, location.origin); } catch { /* the frame may be mid-navigation */ } };
window.pcBeforeClose = () => true; // no local state to flush; passwords and files are never stored
function monitor() {
  clearInterval(poll); clearTimeout(timeout);
  poll = setInterval(() => {
    try {
      const doc = frame.contentDocument;
      if (!doc || /404|not found/i.test(doc.title)) return;
      if (!frame.contentWindow?.webpcNettools) return;
      clearInterval(poll); clearTimeout(timeout); loading.hidden = true;
      doc.addEventListener('pointerdown', () => parent.postMessage({ type: 'pc:focus', appId: 'nettools' }, location.origin), true);
      setupApp('nettools', sendTheme);
    } catch { failed(); }
  }, 150);
  timeout = setTimeout(failed, 45000);
}
retry.addEventListener('click', () => { retry.hidden = true; status.textContent = 'Loading Network and Security Tools…'; frame.src = frame.src; monitor(); });
frame.addEventListener('error', failed);
monitor();
