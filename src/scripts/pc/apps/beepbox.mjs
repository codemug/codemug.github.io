import { setupApp } from './common.mjs';
const frame = document.querySelector('#beepbox-frame');
const loading = document.querySelector('#beepbox-loading');
const status = document.querySelector('#beepbox-status');
const retry = document.querySelector('#beepbox-retry');
const note = document.querySelector('#beepbox-note');
let poll, timeout;
const SONG_KEY = 'pc:beepbox:song:v1';
let mirror, storageWarned;
const warn = message => { note.textContent += ` ${message}`; };
function failed() { clearInterval(poll); clearTimeout(timeout); loading.hidden = false; status.textContent = 'BeepBox could not load. Retry or open the full page.'; retry.hidden = false; }
// BeepBox keeps the song in the app iframe's URL hash. Mirror it to localStorage so closing the
// WebPC window (which only hides the iframe) cannot lose the work.
function restoreSong() {
  const win = frame.contentWindow;
  try {
    const saved = localStorage.getItem(SONG_KEY);
    if (saved && win.location.hash !== saved) win.location.hash = saved;
    // BeepBox updates the song with history.replaceState (no hashchange fires), so mirror by polling.
    clearInterval(mirror);
    mirror = setInterval(() => {
      try { const hash = win.location.hash; if (hash && localStorage.getItem(SONG_KEY) !== hash) localStorage.setItem(SONG_KEY, hash); }
      catch { if (!storageWarned) { storageWarned = true; warn('Could not save your song — browser storage is unavailable. Open the full page and copy the song URL to keep it.'); } }
    }, 500);
  } catch { warn('Could not restore your saved song — browser storage is unavailable.'); }
}
// WebPC close hook: desktop.js calls this before hiding the window. If BeepBox is playing,
// click its OWN Pause button (button.pauseButton is visible only while synth.playing) so the
// app stops believing it is playing — on reopen the user sees Play and one press plays. The
// suspend is the guarantee; a missing button only gets a visible note, never a failed close.
window.pcBeforeClose = () => {
  const win = frame.contentWindow;
  try {
    const pause = win?.document?.querySelector('button.pauseButton');
    if (pause && pause.style.display !== 'none') pause.click();
    else if (!pause) warn('Could not find BeepBox\'s pause control before closing — audio was suspended, but the app may still show playing after reopen.');
  } catch { warn('Could not pause BeepBox before closing — audio was suspended instead.'); }
  const audio = win?.webpcAudio;
  if (audio) audio.suspend();
  return true;
};
window.addEventListener('pagehide', () => { const audio = frame.contentWindow?.webpcAudio; if (audio) audio.suspend(); });
function monitor() {
  clearInterval(poll); clearTimeout(timeout);
  poll = setInterval(() => {
    try {
      const doc = frame.contentDocument;
      if (!doc || /404|not found/i.test(doc.title)) return;
      if (!doc.querySelector('.beepboxEditor')) return;
      clearInterval(poll); clearTimeout(timeout); loading.hidden = true;
      doc.addEventListener('pointerdown', () => parent.postMessage({ type: 'pc:focus', appId: 'beepbox' }, location.origin), true);
      setupApp('beepbox');
      restoreSong();
    } catch { failed(); }
  }, 150);
  timeout = setTimeout(failed, 45000);
}
retry.addEventListener('click', () => { retry.hidden = true; status.textContent = 'Loading BeepBox…'; frame.src = frame.src; monitor(); });
frame.addEventListener('error', failed);
monitor();
