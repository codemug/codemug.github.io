import React from 'react';
import { createRoot } from 'react-dom/client';
import { DocxEditor } from '@casualoffice/docs/react';
import { createEmptyDocument, parseDocx } from '@casualoffice/docs/core';
import { documentBackup, readDocument, validateDocument } from './storage.mjs';

const KEY = 'pc:docs:v1', PREVIOUS = `${KEY}:previous`;
const $ = id => document.getElementById(id);
let api, latest, startupError, storage, busy = false, suspended = false, ready = false, lastSaved = '', rawRecovery = ''; 
let name = 'Untitled document', hostTheme;
try { storage = localStorage; const text = storage.getItem(KEY); rawRecovery = text || ''; if (text) { const saved = readDocument(text); latest = saved.document; name = saved.name; lastSaved = text; } } catch (error) { startupError = error; }
latest ??= createEmptyDocument();
$('name').value = name;
function error(message) { $('error').textContent = message; $('error').hidden = false; $('status').textContent = 'Action needs attention'; }
function clearError() { $('error').hidden = true; }
function save(document = latest) {
  if (!ready) return true;
  if (suspended) return false;
  if (startupError) return false;
  try {
    const text = documentBackup($('name').value.trim() || 'Untitled document', document);
    if (text !== lastSaved) storage.setItem(KEY, text);
    lastSaved = text;
    $('status').textContent = 'Saved in this browser';
    return true;
  } catch { error('Local save failed. Keep this app open and download a JSON backup or DOCX. Browser storage may be full or blocked.'); return false; }
}
function focus() { parent.postMessage({ type: 'pc:focus', appId: 'docs' }, location.origin); }
function download(blob, extension) {
  const a = document.createElement('a'), url = URL.createObjectURL(blob);
  a.href = url; a.download = `${$('name').value.replace(/[<>:"/\\|?*]/g, '-') || 'Document'}.${extension}`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 5000);
}
function setBusy(value) { busy = value; document.querySelectorAll('[data-edit]').forEach(el => { el.disabled = value || !ready; }); }
async function replace(next, nextName, action) {
  if (busy || !confirm(`${action}? Your current document will be kept under Recover previous.`)) return;
  const previous = latest, previousName = $('name').value;
  let previousRaw, wrote = false;
  setBusy(true); suspended = true;
  try {
    validateDocument(next);
    previousRaw = storage.getItem(KEY);
    storage.setItem(PREVIOUS, previousRaw ?? documentBackup(previousName, previous));
    const text = documentBackup(nextName, next);
    await mount(next);
    storage.setItem(KEY, text); wrote = true;
    latest = next; $('name').value = nextName;
    lastSaved = text; startupError = null; clearError(); $('status').textContent = 'Saved in this browser';
  } catch (err) {
    latest = previous; $('name').value = previousName;
    try { await mount(previous); } catch {}
    if (wrote) { try { if (previousRaw === null) storage.removeItem(KEY); else storage.setItem(KEY, previousRaw); } catch {} }
    error(`Document was not replaced. ${err.message}`);
  } finally { suspended = false; setBusy(false); }
}
$('name').addEventListener('input', () => save());
$('new').onclick = () => replace(createEmptyDocument(), 'Untitled document', 'Start a new document');
$('open').onclick = () => $('file').click();
$('file').onchange = async event => {
  const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
  try {
    if (file.size > 10 * 1024 * 1024) throw new Error('Choose a file smaller than 10 MB.');
    if (/\.json$/i.test(file.name)) { const data = readDocument(await file.text()); await replace(data.document, data.name, `Open ${file.name}`); }
    else if (/\.docx$/i.test(file.name)) { const data = await parseDocx(await file.arrayBuffer(), { preloadFonts: false }); await replace(data, file.name.replace(/\.docx$/i, ''), `Open ${file.name}`); }
    else throw new Error('Choose a DOCX or WebPC Docs JSON backup.');
  } catch (err) { error(`Document was not replaced. ${err.message}`); }
};
$('recover').onclick = () => { try { const text = storage.getItem(PREVIOUS); if (!text) throw new Error('No previous document is saved.'); const data = readDocument(text); void replace(data.document, data.name, 'Recover the previous document'); } catch (err) { error(err.message); } };
$('backup').onclick = () => { try { download(new Blob([documentBackup($('name').value, latest)], { type: 'application/json' }), 'json'); } catch (err) { error(err.message); } };
$('export').onclick = async () => {
  setBusy(true);
  try { const bytes = await api.save(); if (!bytes) throw new Error('Document serialization failed.'); download(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), 'docx'); }
  catch (err) { error(`Export failed. ${err.message}`); } finally { setBusy(false); save(); }
};
$('print').onclick = () => api.print();
$('help').onclick = () => $('help-dialog').showModal();
$('retry').onclick = () => { if (save()) clearError(); };
$('raw').onclick = () => { try { download(new Blob([rawRecovery || storage.getItem(KEY) || '']), 'recovery.json'); } catch (err) { error(err.message); } };
window.pcBeforeClose = window.pcFlush = () => { if (busy) { error('Please wait for the file operation to finish before closing.'); return false; } return save(); };
window.addEventListener('beforeunload', event => {
  if (!busy && save()) event.stopImmediatePropagation();
  else { event.preventDefault(); event.returnValue = ''; }
}, true);
window.addEventListener('pagehide', () => save());
document.addEventListener('pointerdown', focus, true);
window.addEventListener('message', event => {
  if (event.origin === location.origin && event.source === parent && event.data?.type === 'pc:theme' && ['dark', 'light'].includes(event.data.theme)) { hostTheme = event.data.theme; document.documentElement.dataset.theme = hostTheme; }
});
document.documentElement.dataset.theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
// The pinned SDK setContent resets its model but can leave the paginated view
// unchanged. Mounting a fresh editor makes replacement atomic at our boundary.
function fitNarrowViewport() {
  if (!api || !ready) return;
  const pageWidth = (latest?.package.document.finalSectionProperties?.pageWidth || 12240) / 15;
  api.setZoom(Math.min(1, Math.max(.25, ($('editor').clientWidth - 48) / pageWidth)));
}
let editorWidth = 0;
new ResizeObserver(entries => { const width = entries[0].contentRect.width; if (width !== editorWidth) { editorWidth = width; fitNarrowViewport(); } }).observe($('editor'));
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (hostTheme) queueMicrotask(() => { document.documentElement.dataset.theme = hostTheme; }); });
const root = createRoot($('editor'));
let generation = 0;
function mount(document) {
  ready = false;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Editor readiness timed out. Reload to retry.')), 15000);
    root.render(<DocxEditor key={++generation} ref={instance => { if (instance) { api = instance; window.webpcDocs = instance; } }} document={document} chrome="embedded" showPanelRail={false} fontFamilies={['Arial', 'Times New Roman', 'Courier New', 'Calibri', 'Cambria', 'Inter']} features={{ titleBar: false, menuBar: false, panelRail: false }} ai={{ enabled: false }} onChange={document => { if (!suspended) { latest = document; save(document); } }} onError={err => { clearTimeout(timeout); error(err.message); reject(err); }} onReady={instance => {
      clearTimeout(timeout); api = instance; ready = true; fitNarrowViewport(); if (hostTheme) document.documentElement.dataset.theme = hostTheme; resolve();
    }} />);
  });
}
mount(latest).then(() => {
  setBusy(false); $('loading').hidden = true;
  if (startupError) { error('Stored data could not be read, or browser storage is blocked. It has been left untouched. Download stored data for recovery, or explicitly choose New/Open.'); $('raw').hidden = false; }
  else save();
  parent.postMessage({ type: 'pc:ready', appId: 'docs' }, location.origin);
}).catch(err => { $('loading').hidden = true; error(`Docs could not start. ${err.message} Saved data has not been changed.`); });
