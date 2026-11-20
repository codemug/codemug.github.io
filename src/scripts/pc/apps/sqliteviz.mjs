import { setupApp } from './common.mjs';
const frame = document.querySelector('#sqliteviz-frame');
const loading = document.querySelector('#sqliteviz-loading');
const status = document.querySelector('#sqliteviz-status');
const retry = document.querySelector('#sqliteviz-retry');
let poll, timeout;
function failed() { clearInterval(poll); clearTimeout(timeout); loading.hidden = false; status.textContent = 'SQLiteViz could not load. Retry or open the full page.'; retry.hidden = false; }
function monitor() {
  clearInterval(poll); clearTimeout(timeout);
  poll = setInterval(() => {
    try {
      const doc = frame.contentDocument;
      if (!doc || /404|not found/i.test(doc.title)) return;
      const app = doc.querySelector('#app');
      // The static LOADING wrapper inside #app is replaced when the app mounts.
      if (!app || app.querySelector('#sqliteviz-loading-wrapper')) return;
      clearInterval(poll); clearTimeout(timeout); loading.hidden = true;
      doc.addEventListener('pointerdown', () => parent.postMessage({ type: 'pc:focus', appId: 'sqliteviz' }, location.origin), true);
      setupApp('sqliteviz');
    } catch { failed(); }
  }, 150);
  timeout = setTimeout(failed, 45000);
}
retry.addEventListener('click', () => { retry.hidden = true; status.textContent = 'Loading SQLiteViz…'; frame.src = frame.src; monitor(); });
frame.addEventListener('error', failed);
monitor();
