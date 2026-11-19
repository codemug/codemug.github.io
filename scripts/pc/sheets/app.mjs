import { STORAGE_KEY, RECOVERY_KEY, MAX_FILE_BYTES, readSaved, saveSnapshot,
  encodeBackup, decodeBackup, validateWorkbook, blankWorkbook, safeFilename } from './storage.mjs';
import { requireEditorApi, commitEditing, watchChanges, watchViewport, importXlsxAcrossFrame } from './adapter.mjs';

const $ = id => document.getElementById(id);
const frame = $('sheets-editor');
const nameInput = $('workbook-name');
const status = $('save-status');
let api, transport, stopWatching, stopViewport, startupError, suspended = false, ready = false, busy = false;
let saveFailed = false;
let savedText = '', currentTheme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
let storage;
try { storage = localStorage; } catch (error) { startupError = error; }
let initial;
try { initial = storage ? readSaved(storage) : null; } catch (error) { startupError = error; }
initial ??= blankWorkbook();

function reportError(message, retry = false) {
  $('error-text').textContent = message;
  $('error-box').hidden = false;
  $('retry-button').hidden = !retry;
  status.textContent = 'Not saved — see message above';
}
function clearError() {
  $('error-box').hidden = true;
  $('download-stored').hidden = true;
}
function notify(type) { parent.postMessage({ type, appId: 'sheets' }, location.origin); }
function snapshot() {
  const data = validateWorkbook(api.getContent());
  data.name = nameInput.value.trim() || 'Untitled workbook';
  return data;
}
function save() {
  if (!ready || suspended) return true;
  if (startupError) return false;
  try {
    const data = snapshot();
    // Exclude savedAt from equality so selection events do not rewrite storage.
    const content = JSON.stringify(data);
    if (content !== savedText) {
      saveSnapshot(storage, data);
      savedText = content;
    }
    status.textContent = 'Saved in this browser';
    if (saveFailed) { clearError(); saveFailed = false; }
    return true;
  } catch {
    saveFailed = true;
    reportError('Could not save in this browser. Keep this window open and use Backup JSON or Export XLSX. Free some browser storage, then retry saving.', true);
    return false;
  }
}
function flush() {
  if (!ready) return true;
  void commitEditing(api, frame.contentDocument).then(save).catch(error => reportError(error.message));
  return save();
}
window.pcBeforeClose = flush;
window.pcFlush = flush;

async function settled() {
  await commitEditing(api, frame.contentDocument);
  await new Promise(resolve => setTimeout(resolve, 0));
}
function setBusy(value) {
  busy = value;
  for (const id of ['new-workbook', 'open-workbook', 'export-xlsx', 'export-json', 'recover-workbook']) $(id).disabled = value || !ready;
  nameInput.disabled = value || !ready;
  if (!value && ready) {
    try { $('recover-workbook').disabled = !storage?.getItem(RECOVERY_KEY); } catch { $('recover-workbook').disabled = true; }
  }
}
function download(blob, filename) {
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
async function replaceWorkbook(load, label) {
  if (busy || !ready) return;
  if (!confirm(`${label}? The current workbook will be kept under Recover previous. Download a backup first for another permanent copy.`)) return;
  setBusy(true);
  let previous, changed = false;
  try {
    await settled();
    previous = structuredClone(snapshot());
    if (!storage) throw new Error('Browser storage is unavailable. Download a backup before leaving this workbook.');
    // A failed recovery write stops replacement; no work is silently discarded.
    saveSnapshot(storage, previous, RECOVERY_KEY);
    suspended = true;
    const next = validateWorkbook(await load());
    api.setContent(next);
    api.univer.getFormula().executeCalculation();
    changed = true;
    nameInput.value = next.name || 'Untitled workbook';
    saveSnapshot(storage, next);
    startupError = null;
    savedText = JSON.stringify(next);
    clearError();
    status.textContent = 'Saved in this browser';
  } catch (error) {
    // importXlsx parses before swapping, but a malformed imported snapshot or
    // quota failure after swap must also restore the in-memory workbook.
    if (previous) {
      try {
        if (changed || JSON.stringify(api.getContent()) !== JSON.stringify(previous)) api.setContent(previous);
        nameInput.value = previous.name;
      } catch { /* Keep the previous recovery copy for the Recover action. */ }
    }
    reportError(`Workbook was not replaced. ${error.message}`);
  } finally { suspended = false; setBusy(false); }
}

nameInput.addEventListener('input', save);
$('new-workbook').addEventListener('click', () => replaceWorkbook(() => blankWorkbook(), 'Start a new workbook'));
$('open-workbook').addEventListener('click', () => $('file-input').click());
$('file-input').addEventListener('change', async event => {
  const file = event.target.files?.[0]; event.target.value = '';
  if (!file) return;
  try {
    if (file.size > MAX_FILE_BYTES) throw new Error('Choose a file smaller than 20 MB.');
    if (/\.json$/i.test(file.name)) {
      const data = decodeBackup(await file.text());
      await replaceWorkbook(() => data, `Open ${file.name}`);
    } else if (/\.xlsx$/i.test(file.name)) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (bytes[0] !== 80 || bytes[1] !== 75) throw new Error('This is not a valid XLSX file.');
      await replaceWorkbook(async () => {
        const data = await importXlsxAcrossFrame(api, frame.contentWindow, bytes);
        data.name = file.name.replace(/\.xlsx$/i, '') || 'Workbook';
        return data;
      }, `Open ${file.name}`);
    } else throw new Error('Choose an XLSX file or a JSON backup from this app.');
  } catch (error) { reportError(`Workbook was not replaced. ${error.message}`); }
});
$('recover-workbook').addEventListener('click', async () => {
  try {
    const previous = readSaved(storage, RECOVERY_KEY);
    if (!previous) throw new Error('No previous workbook is available.');
    await replaceWorkbook(() => previous, 'Restore the previous workbook');
  } catch (error) { reportError(error.message); }
});
$('export-json').addEventListener('click', async () => {
  try { await settled(); download(new Blob([encodeBackup(snapshot())], { type: 'application/json' }), `${safeFilename(nameInput.value)}.json`); }
  catch (error) { reportError(`Backup failed. ${error.message}`); }
});
$('export-xlsx').addEventListener('click', async () => {
  setBusy(true);
  try { await settled(); status.textContent = 'Preparing XLSX…'; download(await api.exportXlsx(), `${safeFilename(nameInput.value)}.xlsx`); status.textContent = 'XLSX downloaded'; }
  catch (error) { reportError(`XLSX export failed. Your workbook is still open. ${error.message}`); }
  finally { setBusy(false); }
});
$('help-button').addEventListener('click', () => $('help-dialog').showModal());
$('download-stored').addEventListener('click', () => {
  try { download(new Blob([storage.getItem(STORAGE_KEY) ?? ''], { type: 'application/json' }), 'stored-workbook-recovery.json'); }
  catch (error) { reportError(error.message); }
});
$('retry-button').addEventListener('click', () => ready ? save() : location.reload());
window.addEventListener('pagehide', event => { flush(); if (!event.persisted) { stopWatching?.(); stopViewport?.(); } });
window.addEventListener('beforeunload', event => {
  if (ready && !flush()) { event.preventDefault(); event.returnValue = ''; }
});
document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });
document.addEventListener('pointerdown', () => notify('pc:focus'), true);
window.addEventListener('message', event => {
  if (event.origin !== location.origin) return;
  if (event.source === parent && event.data?.type === 'pc:theme' && ['light', 'dark'].includes(event.data.theme)) {
    currentTheme = event.data.theme;
    document.documentElement.dataset.theme = currentTheme;
    transport?.sendSetTheme({ theme: currentTheme });
  }
  if (event.source === frame.contentWindow && event.data?.type === 'pc:sheets-error') {
    reportError('The spreadsheet files could not load. Check your connection and retry. Your saved workbook has not been changed.', true);
    $('loading').hidden = true;
  }
});
document.documentElement.dataset.theme = currentTheme;

async function boot() {
  try {
    const bridgeUrl = new URL('/pc/vendor/sheets/embed.js', location.origin).href;
    const { EmbedHostTransport } = await import(/* @vite-ignore */ bridgeUrl);
    transport = new EmbedHostTransport({ app: 'sheet', iframeWindow: frame.contentWindow, embedOrigin: location.origin });
    transport.on({
      onEditorReady: () => transport.sendHostHello({ capabilities: ['load', 'save'] }),
      onLoadRequest: async () => {
        const response = await fetch('/pc/vendor/sheets/blank.xlsx');
        if (!response.ok) throw new Error('Starter workbook unavailable.');
        return { ok: true, bytes: await response.arrayBuffer(), fileName: 'Workbook.xlsx' };
      },
      onSaveNotify: () => save(),
      onError: () => reportError('The spreadsheet could not open. Retry loading; your saved workbook is unchanged.', true),
      // Native dialogs are implemented by the SDK. Only these host-owned
      // requests remain, and their menus are disabled below.
      onDialogRequest: ({ kind }) => reportError(`${kind} is unavailable in this local edition. Use the workbook actions above.`),
    });
    frame.src = `/pc/apps/sheets/editor/?app=sheet&docId=local&viewMode=editor&theme=${currentTheme}`;
    const started = Date.now();
    while (!(api = requireEditorApi(frame.contentWindow))) {
      if (Date.now() - started > 55_000) throw new Error('The spreadsheet took too long to load.');
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    api.setContent(initial);
    // The worker and React chrome settle after the imperative API appears.
    // Do not accept user input until the first calculation has completed.
    const formula = api.univer.getFormula();
    const calculated = formula.onCalculationEnd();
    formula.executeCalculation();
    let calculationTimeout;
    try {
      await Promise.race([calculated, new Promise((_, reject) => {
        calculationTimeout = setTimeout(() => reject(new Error('The formula worker could not initialize. Check your connection and retry.')), 15_000);
      })]);
    } finally { clearTimeout(calculationTimeout); }
    await new Promise(resolve => frame.contentWindow.requestAnimationFrame(() => frame.contentWindow.requestAnimationFrame(resolve)));
    nameInput.value = initial.name || 'Untitled workbook';
    transport.sendSetFeatures({ features: { file: false, help: false, branding: false,
      charts: false, 'insert-chart': false, pivots: false, 'pivot-table': false, sparklines: false } });
    transport.sendSetTheme({ theme: currentTheme });
    ready = true;
    stopWatching = watchChanges(api, save, error => reportError(`Spreadsheet error: ${error.message}`));
    stopViewport = watchViewport(api, frame.contentWindow, error => reportError(error.message));
    frame.contentDocument.addEventListener('pointerdown', () => notify('pc:focus'), true);
    frame.contentDocument.addEventListener('keydown', event => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); flush(); }
    }, true);
    setBusy(false);
    $('loading').hidden = true;
    if (startupError) {
      reportError('The saved workbook could not be read, or browser storage is blocked. Existing stored data has been left untouched. Download it for recovery, or use New/Open to explicitly replace it.');
      try { $('download-stored').hidden = !storage?.getItem(STORAGE_KEY); } catch { /* unavailable */ }
    } else save();
    notify('pc:ready');
  } catch (error) {
    stopWatching?.(); stopViewport?.();
    reportError(`Could not load Sheets. ${error.message} Your saved workbook has not been changed.`, true);
    $('loading').hidden = true;
  }
}
void boot();
