// WebPC Packet Viewer (vendor page entry). Runs the wiregasm engine in worker.js and
// keeps the UI on the main thread: capture file in -> packet list out -> protocol tree
// and hex dump for the selected row. All dissector output renders as text (textContent
// only). No network anywhere: the page, the worker and the two engine files are
// same-origin, and captures never leave this browser.
import { detectCaptureFormat, formatHexDump, base64ToBytes } from './helpers.mjs';

// Theme: read from localStorage (the WebPC wrapper and the headless check set it), and keep it
// in sync with the desktop's pc:theme message. Defaults to light.
function applyTheme(t) { document.documentElement.dataset.theme = t === 'dark' ? 'dark' : 'light'; }
try { applyTheme(localStorage.getItem('packets:theme')); } catch { applyTheme('light'); }
window.addEventListener('message', e => {
  if (e.origin === location.origin && e.data?.type === 'pc:theme' && ['dark', 'light'].includes(e.data.theme)) {
    applyTheme(e.data.theme);
    try { localStorage.setItem('packets:theme', e.data.theme); } catch { /* private mode */ }
  }
});

const $ = id => document.getElementById(id);
const progressEl = $('pk-progress');
const errEl = $('pk-err');
const filterErrEl = $('pk-filter-err');
const body = document.body;
const worker = new Worker('worker.js');

let columns = [];
let framesByNum = new Map();
let selected = null;
let filter = '';
let engineStarted = false;

function setStatus(text, isErr = false) { progressEl.textContent = text; progressEl.classList.toggle('pk-err', isErr); }
function setErr(text) { errEl.textContent = text ?? ''; }

worker.addEventListener('message', e => {
  const m = e.data ?? {};
  if (m.type === 'progress') { if (!m.detail.startsWith('**') && !m.detail.includes('DFilter')) setStatus(m.detail); }
  else if (m.type === 'loaded') onLoaded(m.summary);
  else if (m.type === 'frames') onFrames(m.columns, m.frames, m.matched);
  else if (m.type === 'frame') onFrame(m.frame);
  else if (m.type === 'test-filter') onTestFilter(m.ok, m.error);
  else if (m.type === 'warmed') setStatus('Engine ready — open a .pcap or .pcapng file.');
  else if (m.type === 'error') { setErr(m.error); setStatus('Engine error.', true); }
});

function onLoaded(summary) {
  $('pk-summary').textContent = `${summary.packet_count} packets · ${summary.file_type} · ${summary.file_encap_type} encap · ${(summary.elapsed_time ?? 0)} s elapsed`;
  setErr('');
  selected = null;
  requestFrames();
}

function requestFrames() {
  worker.postMessage({ type: 'frames', filter, limit: 1000 });
}

function onFrames(cols, rows, matched) {
  columns = cols;
  framesByNum = new Map(rows.map(r => [r[0], r[1]]));
  renderTable();
  if (selected !== null && !framesByNum.has(selected)) selected = rows.length ? rows[0][0] : null;
  const shown = rows.length;
  setStatus(`${matched} packets match filter "${filter || '(all)'}"${shown < matched ? ` — showing first ${shown}` : ''}`);
  if (selected === null) { $('pk-tree').textContent = 'No packet selected.'; $('pk-hex').textContent = ''; return; }
  requestFrame(selected);
}

function requestFrame(num) { worker.postMessage({ type: 'frame', number: num }); }

function onFrame(f) {
  const lines = f.nodes.map(n => '  '.repeat(n.depth) + n.label + (n.off ? ` [${n.off}]` : ''));
  if (f.comments.length) lines.push('', ...f.comments.map(c => `# ${c}`));
  $('pk-tree').textContent = lines.join('\n');
  const hex = f.dataSources.map(d => `${d.name}\n${formatHexDump(base64ToBytes(d.data))}`).join('\n\n');
  $('pk-hex').textContent = hex;
}

function renderTable() {
  const table = $('pk-table');
  const thead = table.querySelector('thead');
  thead.textContent = '';
  const hr = document.createElement('tr');
  for (const c of columns) { const th = document.createElement('th'); th.textContent = c; hr.appendChild(th); }
  thead.appendChild(hr);
  const tbody = table.querySelector('tbody');
  tbody.textContent = '';
  for (const [num, cols] of framesByNum) {
    const tr = document.createElement('tr');
    tr.className = 'pk-row';
    tr.dataset.num = String(num);
    if (num === selected) tr.classList.add('pk-sel');
    for (const c of cols) { const td = document.createElement('td'); td.textContent = c; tr.appendChild(td); }
    tr.addEventListener('click', () => { if (selected !== num) { selected = num; renderTable(); requestFrame(num); } });
    tbody.appendChild(tr);
  }
}

function onTestFilter(ok, error) {
  if (!ok) { filterErrEl.textContent = error || 'invalid display filter'; return; }
  filterErrEl.textContent = '';
  requestFrames();
}

$('pk-filter-apply').addEventListener('click', applyFilter);
$('pk-filter').addEventListener('keydown', e => { if (e.key === 'Enter') applyFilter(); });
function applyFilter() {
  const f = $('pk-filter').value.trim();
  if (!f) { filter = ''; filterErrEl.textContent = ''; requestFrames(); return; }
  filter = f; // remember the filter BEFORE the round-trip: onFrames reports it in the status line
  worker.postMessage({ type: 'test-filter', filter: f });
}

// File in: input or drag-and-drop. The magic bytes decide, not the extension.
async function openFile(file) {
  setErr('');
  filterErrEl.textContent = '';
  const bytes = new Uint8Array(await file.arrayBuffer());
  const fmt = detectCaptureFormat(bytes);
  if (fmt.kind === 'unknown') { setErr(`"${file.name}" is not a recognized capture (no pcap/pcapng magic found).`); return; }
  if (!engineStarted) { engineStarted = true; setStatus(`Starting the engine and loading ${file.name}…`); }
  else setStatus(`Loading ${file.name}…`);
  worker.postMessage({ type: 'load-file', name: file.name, bytes: bytes.buffer }, [bytes.buffer]);
}
$('pk-browse').addEventListener('click', () => $('pk-file').click());
$('pk-file').addEventListener('change', e => { const f = e.target.files?.[0]; if (f) openFile(f); e.target.value = ''; });
$('pk-load-engine').addEventListener('click', () => { engineStarted = true; setStatus('Loading the engine…'); worker.postMessage({ type: 'warm' }); });

['dragover', 'drop'].forEach(t => body.addEventListener(t, e => e.preventDefault()));
body.addEventListener('drop', e => { const f = e.dataTransfer?.files?.[0]; if (f) openFile(f); });

// The WebPC wrapper polls for this flag to hide its loading overlay.
window.webpcPackets = { ready: true };
