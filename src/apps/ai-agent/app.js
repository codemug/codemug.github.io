import { ModelClient } from './model-client.js';
import { CloudClient } from './cloud-client.js';
import { ChromeModelClient, chromeAvailability, chromeExecutors, chromeDownload, chromeToolGates, CHROME_TOOL_APIS } from './chrome-ai.js';
import { pickFile } from './picker.mjs';
import { createFileHost } from './files-host.js';
import { createSearchHost } from './search-host.js';
import { AgentSession } from './session.js';
import { ConversationStore, validateConversation, MODEL_KEY, LEGACY_MODEL_KEY } from './storage.js';
import { MODELS, DEFAULT_MODEL } from './models.js';
import { checkImage, IMAGE_MAX_SIDE } from './agent.js';
import { webSearch, httpGet } from './web.js';
import { runJavaScript } from './sandbox.js';
const $ = id => document.getElementById(id);
// Cloud models are opt-in per session: the key lives only in CloudClient's memory and is never persisted.
const CLOUD_MODELS = { 'cloud:anthropic': 'Claude · cloud (your key)', 'cloud:openai': 'OpenAI-compatible · cloud (your key)' };
const isCloud = key => Boolean(CLOUD_MODELS[key]);
const CHROME_MODEL = 'chrome:builtin'; const isChrome = key => key === CHROME_MODEL;
const store = new ConversationStore(); let initialized = false, loading = false, loadVersion = 0, selected = DEFAULT_MODEL, pendingImage = null;
try { const saved = localStorage.getItem(MODEL_KEY) ?? localStorage.getItem(LEGACY_MODEL_KEY); if (MODELS[saved]) selected = saved; } catch {}
for (const [key, model] of Object.entries(MODELS)) $('model').add(new Option(`${model.label} · ${model.size}`, key));
for (const [key, label] of Object.entries(CLOUD_MODELS)) $('model').add(new Option(label, key));
$('model').value = selected;
const cloud = new CloudClient();
const chrome = new ChromeModelClient(self);
// The session talks to whichever backend is active: the local worker, the BYOK cloud client or Chrome's on-device model.
function bindClient() { session.client = isChrome(selected) ? chrome : isCloud(selected) ? cloud : client; }
const status = text => { $('status').textContent = text; };
const error = text => { $('error').textContent = text; $('error').hidden = !text; };
function storageError(text) { $('storage-warning').hidden = false; $('storage-warning').querySelector('span').textContent = `${text} Your chat is still in memory; export it before closing.`; $('save-state').textContent = 'Not saved — export your chat'; }
function controls() {
  $('load-model').disabled = !initialized || loading || Boolean(session.active) || client.ready || isCloud(selected) || (isChrome(selected) && chrome.ready);
  $('stop').disabled = !(loading || session.active || client.ready || cloud.ready || chrome.ready);
  $('send').disabled = !initialized || !session.client.ready || Boolean(session.active) || loading;
  $('new-chat').disabled = !initialized; $('import').disabled = !initialized; $('previous').disabled = !initialized;
  $('model-state').textContent = loading ? 'Loading…' : cloud.ready ? `Cloud · ${cloud.host}` : isChrome(selected) && chrome.ready ? 'Chrome · on device' : client.ready ? session.active ? 'Working locally' : 'Ready · on device' : 'Not loaded';
  imageInputControls();
}
// Image input is offered by the Qwen vision models and by an active cloud model; LFM3 and the on-device
// Chrome model are text-only.
function imageInputControls() {
  const cloudSelected = isCloud(selected);
  const vision = Boolean(MODELS[selected]?.vision) || (cloudSelected && cloud.ready);
  const box = $('image-input');
  box.disabled = !vision || loading || Boolean(session.active);
  if (!vision) box.checked = false;
  $('attach').disabled = !box.checked;
  $('image-note').textContent = isChrome(selected) ? 'Chrome built-in model is text-only' : cloudSelected ? (cloud.ready ? `sent to ${cloud.host}` : 'enable it in Settings') : (MODELS[selected]?.vision ? `+${MODELS[selected].vision.size} when first used` : 'Qwen models only');
}
const nearBottom = () => $('conversation').scrollHeight - $('conversation').scrollTop - $('conversation').clientHeight < 100;
function follow(wasNear) { if (wasNear) $('conversation').scrollTop = $('conversation').scrollHeight; }
function message(role, content = '') {
  const near = nearBottom(); $('welcome').hidden = true;
  const root = document.createElement('article'); root.className = `message ${role}`;
  const label = document.createElement('div'); label.className = 'message-label'; label.textContent = role === 'user' ? 'You' : 'AI Agent';
  const body = document.createElement('div'); body.className = 'message-body'; body.textContent = content;
  root.append(label, body); $('messages').append(root); follow(near); return body;
}
function toolCard(data) {
  const root = document.createElement('details'); root.className = 'tool';
  const label = document.createElement('summary'); label.textContent = `${data.name} · running`;
  const body = document.createElement('pre'); body.textContent = JSON.stringify(data.arguments, null, 2);
  root.append(label, body); $('messages').append(root); data.element = root; return root;
}
function toolResult(card, result) {
  card.element.querySelector('summary').textContent = `${card.name} · ${result.error ? 'could not complete' : 'complete'}`;
  card.element.querySelector('pre').textContent = JSON.stringify({ arguments: card.arguments, result }, null, 2);
}
function render(value) {
  $('messages').replaceChildren(); $('welcome').hidden = value.history.length > 0;
  const cards = new Map();
  for (const item of value.history) {
    if (item.role === 'tool') { const card = cards.get(item.tool_call_id); if (card) { let result; try { result = JSON.parse(item.content); } catch { result = { content: item.content }; } toolResult(card, result); } }
    else {
      if (item.content) message(item.role, item.content);
      for (const call of item.tool_calls ?? []) { const card = { ...call.function }; toolCard(card); cards.set(call.id, card); }
    }
  }
  $('conversation').scrollTop = value.history.length ? $('conversation').scrollHeight : 0;
}
const client = new ModelClient({ failure: err => { error(err.message); controls(); }, progress: data => {
  if (!loading) return;
  const percent = Number(data.progress); $('progress').hidden = false;
  if (Number.isFinite(percent)) { $('progress').max = 100; $('progress').value = percent; }
  else $('progress').removeAttribute('value');
  status(`${data.status ?? 'Loading'}${data.file ? ` · ${data.file}` : ''}${Number.isFinite(percent) ? ` · ${Math.round(percent)}%` : ''}`);
} });
// Chrome built-in AI (on-device): a tool is offered only when its API reports 'available' — a
// model-initiated create() has no user gesture to start Chrome's own download. The Settings buttons
// for 'downloadable' APIs are that gesture; on success availability is re-checked and the tool appears.
const chromeTools = {}; let chromeAvail = null, chromeExec_ = null, chromeDownloading = false;
chromeAvailability(self).then((availability) => {
  chromeAvail = availability; chromeExec_ = chromeExecutors(self, status);
  applyChromeGates(); renderChromeStatus();
  if (availability.languageModel !== 'unavailable') { $('model').add(new Option('Chrome built-in · on-device', CHROME_MODEL)); controls(); }
});
function applyChromeGates() {
  const gates = chromeToolGates(chromeAvail);
  chromeTools.translate = gates.translate ? chromeExec_.translate : null;
  chromeTools.summarize = gates.summarize ? chromeExec_.summarize : null;
  chromeTools.detectLanguage = gates.detectLanguage ? chromeExec_.detectLanguage : null;
}
function renderChromeStatus() {
  const box = $('chrome-downloads'); box.replaceChildren();
  if (!chromeAvail) return;
  $('chrome-status').textContent = [['Prompt API (chat)', chromeAvail.languageModel], ['Translator', chromeAvail.translator], ['Summarizer', chromeAvail.summarizer], ['Language detector', chromeAvail.detector]].map(([name, s]) => `${name}: ${s}`).join(' · ');
  for (const [toolKey, api] of Object.entries(CHROME_TOOL_APIS)) {
    if (chromeAvail[api.availabilityKey] !== 'downloadable') continue;
    const b = document.createElement('button');
    b.textContent = `Download ${api.label} model`;
    b.disabled = chromeDownloading;
    b.addEventListener('click', () => chromeDownloadTool(toolKey, api));
    box.append(b);
  }
}
async function chromeDownloadTool(toolKey, api) {
  chromeDownloading = true; renderChromeStatus();
  try {
    await chromeDownload(self, toolKey, status); // the click is the user gesture Chrome's create() needs
    chromeAvail = await chromeAvailability(self); // re-check so the tool appears once the download completes
    applyChromeGates();
    status(`Chrome ${api.label} model ready.`);
  } catch (err) {
    if (err.name !== 'AbortError') status(`Chrome ${api.label} model download failed: ${err?.message ?? err}`);
  } finally { chromeDownloading = false; renderChromeStatus(); }
}
// ---------- files (grants + search index, AI-2/AI-3) ----------
// Grants are per session: they live only in this page's memory and are cleared on reload (fresh
// page), New chat and close. They are never written to IndexedDB, localStorage or exports.
const fileGrants = [];
const fileHost = createFileHost({ grants: fileGrants, confirm: text => confirm(text), note: status });
const fileTools = { grants: null };
// The search index is per session too: memory only, cleared with the grants, offered while it has
// chunks. Its embedding model (about 23 MB, Hugging Face, pinned revision) runs in its own worker
// on the WASM device and is downloaded only by the explicit Build click.
let indexAbort = null;
const embedClient = new ModelClient({
  createWorker: () => new Worker(new URL('./embed-worker.js', import.meta.url), { type: 'module' }),
  progress: (p) => { if (indexAbort && p.file) searchStatus(`Downloading ${p.file}: ${p.total ? Math.round(p.progress ?? 0) + '%' : Math.round((p.loaded ?? 0) / 1024) + ' KB'}`); },
});
const searchHost = createSearchHost({ grants: fileGrants, embed: (texts) => embedClient.embed(texts), note: searchStatus, onState: applyFileGates });
function searchStatus(text) { $('files-index-status').textContent = text; }
async function searchFiles(query, k) {
  // A reload of the worker happens only after a Cancel terminated it; with an index present the
  // model files are already fetched (and cached) by the Build click, so this adds no new download.
  if (!embedClient.ready) await embedClient.load('embed');
  return searchHost.search(query, k);
}
function renderIndexControls() {
  const busy = indexAbort !== null;
  $('files-build').disabled = busy || !fileGrants.length;
  $('files-cancel-index').disabled = !busy;
  $('files-build').textContent = searchHost.has() ? 'Rebuild search index' : 'Build search index (downloads about 23 MB once)';
}
function applyFileGates() {
  const on = fileGrants.length > 0;
  fileTools.grants = on ? [...fileGrants] : null;
  fileTools.list = on ? fileHost.list : undefined;
  fileTools.read = on ? fileHost.read : undefined;
  fileTools.write = on ? fileHost.write : undefined;
  fileTools.search = searchHost.has() ? searchFiles : undefined;
  renderIndexControls();
}
function renderFileGrants() {
  const box = $('files-grants'); box.replaceChildren();
  if (!fileGrants.length) { box.textContent = 'No grants yet.'; return; }
  for (const grant of fileGrants) {
    const row = document.createElement('p');
    const label = document.createElement('span');
    label.textContent = `${grant.kind === 'folder' ? '▸ ' : '▪ '}${grant.root || '(Files root)'} · ${grant.kind}`;
    const revoke = document.createElement('button');
    revoke.textContent = 'Revoke';
    revoke.addEventListener('click', () => { fileGrants.splice(fileGrants.indexOf(grant), 1); searchHost.revokeGrant(grant); applyFileGates(); renderFileGrants(); });
    row.append(label, ' ', revoke); box.append(row);
  }
}
$('files-grant').addEventListener('click', async () => {
  error('');
  const picked = await pickFile({ select: 'any', title: 'Give the agent access to…' });
  if (!picked) return;
  const grant = picked.name != null ? { root: picked.path, kind: 'file' } : { root: picked.path, kind: 'folder' };
  if (fileGrants.some((g) => g.root === grant.root && g.kind === grant.kind)) { status('Already granted.'); return; }
  fileGrants.push(grant); applyFileGates(); renderFileGrants();
  status(`Granted ${grant.kind} "${grant.root || '(Files root)'}". ${isCloud(selected) ? 'Note: with a cloud model, file contents the agent reads are sent to that provider.' : ''}`);
});
$('files-build').addEventListener('click', async () => {
  error('');
  if (!fileGrants.length || indexAbort) return;
  indexAbort = new AbortController();
  renderIndexControls();
  searchStatus('Downloading the search model (about 23 MB, Hugging Face) and indexing the granted files…');
  try {
    if (!embedClient.ready) await embedClient.load('embed');
    await searchHost.indexFiles({ signal: indexAbort.signal });
  } catch (err) {
    if (err.name === 'AbortError') searchStatus('Cancelled — the index keeps what it already had.');
    else error(err.message);
  } finally {
    indexAbort = null;
    applyFileGates();
  }
});
$('files-cancel-index').addEventListener('click', () => { indexAbort?.abort(); embedClient.stop(); });
applyFileGates(); renderFileGrants();
// AI-4: the run_code tool reaches the Linux terminal app's exec service over a same-origin
// BroadcastChannel: the terminal page shows the approval prompt and runs the code in its guest.
// The reply arrives when the run finishes, is denied, or the guest is not running; the wall timer
// only bounds the wait for a closed terminal app (or a run still pending the user's approval).
// The pending map entry is deleted exactly once, by the settle guard (delete-once = first settle
// wins, so the late wall timer cannot double-resolve a settled run).
const execChannel = new BroadcastChannel('webpc-terminal');
const execPending = new Map();
let execSeq = 0;
execChannel.onmessage = (event) => {
  const reply = event.data;
  if (!reply || (reply.type !== 'exec-result' && reply.type !== 'exec-error')) return;
  const settle = execPending.get(reply.id);
  if (settle) settle(reply);
};
function runCode(lang, code, timeoutMs) {
  const id = `agent-${Date.now()}-${execSeq++}`;
  return new Promise((resolve) => {
    const settle = (reply) => { if (execPending.delete(id)) resolve(reply); };
    execPending.set(id, settle);
    setTimeout(() => settle({ type: 'exec-error', id, reason: 'no-terminal' }), timeoutMs + 60000); // run limit + time for the user to approve
    execChannel.postMessage({ type: 'exec-request', id, from: 'AI Agent', lang, code, timeoutMs });
  });
}
const session = new AgentSession({ client, store, webSearch, httpGet, runJavaScript, runCode, chrome: chromeTools, files: fileTools, proxyAllowed: () => $('reader-proxy').checked, emit(type, data) {
  if (type === 'busy') { controls(); if (!data) status(client.ready ? 'Ready for your next question.' : 'Load a model to continue.'); }
  else if (type === 'status') status(data);
  else if (type === 'error') error(data);
  else if (type === 'saved') { $('storage-warning').hidden = true; $('save-state').textContent = 'Saved in this browser'; }
  else if (type === 'storage-error') storageError(data);
  else if (type === 'reset') render(data);
  else if (type === 'user') message('user', data.content);
  else if (type === 'reply-start') data.element = message('assistant');
  else if (type === 'reply-token') { const near = nearBottom(); data.bubble.element.textContent = data.text; follow(near); }
  else if (type === 'tool-start') toolCard(data);
  else if (type === 'tool-result') toolResult(data.toolCard, data.result);
} });
function cancel(text = isCloud(selected) || isChrome(selected) ? 'Stopped. Send the message again to continue.' : 'Stopped. Load the model again to continue; cached downloads are kept.') {
  loadVersion++; loading = false; session.cancel(); $('progress').hidden = true;
  document.querySelectorAll('.message-body:empty').forEach(el => { el.textContent = 'Stopped.'; });
  document.querySelectorAll('.tool summary').forEach(el => { if (el.textContent.endsWith('· running')) el.textContent = el.textContent.replace('· running', '· stopped'); });
  controls(); status(text);
}
function modelInfo() {
  if (isCloud(selected)) {
    $('download-note').textContent = 'Cloud model: nothing downloads locally. Enter your API key in Settings and confirm the opt-in; your prompts, tool results and attached images go to the provider named there.';
    $('model-license').replaceChildren(document.createTextNode('The provider sets its own terms and pricing; the key is used only in this browser session.'));
    return;
  }
  if (isChrome(selected)) {
    $('download-note').textContent = 'Chrome built-in model: nothing downloads from this site. Load it to start Chrome’s own on-device model download (needs at least 22 GB free space). Chat, translation and summarization stay on this device.';
    $('model-license').replaceChildren(document.createTextNode('On-device: no data is sent to Google or any third party when using the model.'));
    return;
  }
  const model = MODELS[selected];
  $('download-note').textContent = `Load ${model.label} when ready: ${model.size} of model files from Hugging Face. No model files download automatically. Chat and computation stay on device; web tools make the requests you ask for.`;
  const link = document.createElement('a'); link.href = `https://huggingface.co/${model.repo}/tree/${model.revision}`; link.target = '_blank'; link.rel = 'noopener'; link.textContent = `${model.label} · ${model.license}`;
  $('model-license').replaceChildren(link, document.createTextNode('. Model weights have their own license. Sizes are approximate; small models may miss tools or return incorrect answers.'));
}
async function doLoad(vision) {
  cancel(); const version = ++loadVersion; loading = true; controls(); error(''); $('progress').hidden = false; $('progress').removeAttribute('value');
  if (isChrome(selected)) {
    // The click is the user gesture Chrome's create() needs; its monitor drives the status line.
    status('Loading Chrome’s on-device model…');
    try {
      await chrome.load(status); if (version !== loadVersion) return;
      status('Chrome model ready. Everything runs on this device.'); $('message').focus();
    } catch (err) { if (version === loadVersion && err.name !== 'AbortError') error(err.message); }
    finally { if (version === loadVersion) { loading = false; $('progress').hidden = true; controls(); } }
    return;
  }
  status('Checking WebGPU…');
  try {
    if (!navigator.gpu) throw new Error('WebGPU is unavailable. Use a compatible browser/device with hardware acceleration. Your saved conversation is still available.');
    const adapter = await navigator.gpu.requestAdapter();
    if (version !== loadVersion) return;
    if (!adapter) throw new Error('No WebGPU adapter is available. Your saved conversation is still available.');
    if (!adapter.features.has('shader-f16')) throw new Error('This WebGPU device does not support shader-f16, required by these models.');
    const spec = MODELS[selected];
    status(vision && spec.vision ? `Loading ${spec.label} with image support · ${spec.size} + ${spec.vision.size} vision encoder…` : `Loading ${spec.label} · first download ${spec.size}…`);
    await client.load(selected, { vision }); if (version !== loadVersion) return;
    status('Model ready. Messages are processed on this device.'); $('message').focus();
  } catch (err) { if (version === loadVersion && err.name !== 'AbortError') error(err.message); }
  finally { if (version === loadVersion) { loading = false; $('progress').hidden = true; controls(); } }
}
$('load-model').addEventListener('click', () => doLoad($('image-input').checked));
$('stop').addEventListener('click', () => cancel());
$('model').addEventListener('change', () => {
  cancel('Model changed. Load it when you’re ready.');
  selected = $('model').value;
  cloud.clear(); bindClient();
  // Cloud and on-device selections are per session only: never persisted to MODEL_KEY.
  if (!isCloud(selected) && !isChrome(selected)) { try { localStorage.setItem(MODEL_KEY, selected); } catch {} if (!MODELS[selected]?.vision) clearPendingImage(); }
  modelInfo(); controls();
});
$('new-chat').addEventListener('click', async () => {
  if ((session.history.length || session.active) && !confirm('Start a new chat? The current stored chat will be kept as the previous record. Export it first if you need a permanent copy.')) return;
  cancel(); error(''); cloud.clear(); indexAbort?.abort(); indexAbort = null; searchHost.dispose(); embedClient.stop(); fileGrants.length = 0; applyFileGates(); renderFileGrants(); bindClient(); await session.newChat();
  if (isCloud(selected)) status('New chat started. The cloud key was cleared — confirm the cloud model in Settings to continue.');
  controls(); $('message').focus();
});
$('composer').addEventListener('submit', async event => {
  event.preventDefault(); if ($('send').disabled) return;
  const text = $('message').value; if (!text.trim()) return;
  error('');
  try {
    let image = null;
    if (pendingImage) {
      if (isCloud(selected)) {
        if (!cloud.ready) { clearPendingImage(); throw new Error('Confirm the cloud model in Settings first (your key was cleared).'); }
        image = { name: pendingImage.name, width: pendingImage.width, height: pendingImage.height, data: pendingImage.data, type: pendingImage.type };
      } else if (!MODELS[selected]?.vision) clearPendingImage();
      else {
        // First image with a text-loaded model: fetch the vision encoder now, on demand.
        if (client.ready && !client.vision) await doLoad(true);
        if (!client.ready) throw new Error('The model did not finish loading. Send the message again.');
        image = { name: pendingImage.name, width: pendingImage.width, height: pendingImage.height, data: pendingImage.data, type: pendingImage.type };
      }
    }
    await session.send(text, image);
    $('message').value = '';
    if (image) clearPendingImage();
  } catch (err) { error(err.message); }
  controls();
});
// ---------- image input (Qwen models) ----------
function clearPendingImage() {
  pendingImage = null;
  $('image-chip').hidden = true;
  imageInputControls();
}
function renderImageChip() {
  $('image-chip').hidden = false;
  $('image-preview').src = pendingImage.url;
  $('image-name').textContent = `${pendingImage.name} · ${pendingImage.width}×${pendingImage.height}`;
  $('image-name').title = 'Images are not kept after a reload; the chat stores a text marker.';
}
async function prepareImage(file) {
  const problem = checkImage(file);
  if (problem) { error(problem); return; }
  let bitmap;
  try { bitmap = await createImageBitmap(file); } catch { error('Could not decode that image. Try a PNG, JPEG or WebP.'); return; }
  // Downscale the longest side to 768 px (keeps the pixel payload small; the model rescales internally).
  const scale = Math.min(1, IMAGE_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height); bitmap.close();
  const { data } = canvas.getContext('2d').getImageData(0, 0, width, height);
  pendingImage = { name: file.name.slice(0, 100) || 'image.png', width, height, data: new Uint8Array(data), type: file.type, url: canvas.toDataURL('image/png') };
  renderImageChip(); error('');
}
$('attach').addEventListener('click', () => { if (!$('attach').disabled) $('image-file').click(); });
$('image-file').addEventListener('change', async () => {
  const file = $('image-file').files?.[0]; $('image-file').value = '';
  if (!file) return;
  if (!$('image-input').checked) { error('Turn on Image input first (Qwen models only).'); return; }
  await prepareImage(file);
});
$('image-remove').addEventListener('click', () => clearPendingImage());
$('image-input').addEventListener('change', async () => {
  if (isCloud(selected) || isChrome(selected)) { if (!$('image-input').checked) clearPendingImage(); imageInputControls(); return; }
  const spec = MODELS[selected];
  if (!spec.vision || !$('image-input').checked) { if (!$('image-input').checked) clearPendingImage(); imageInputControls(); return; }
  imageInputControls();
  // Enabling Image input with a loaded text-only model fetches the vision encoder now, on demand.
  if (client.ready && !client.vision) {
    status(`Downloading image support for ${spec.label} (${spec.vision.size})…`);
    await doLoad(true);
  }
});
// ---------- cloud model (BYOK, opt-in per session) ----------
const cloudProvider = () => document.querySelector('input[name="cloud-provider"]:checked').value;
function cloudNotice() {
  const host = cloudProvider() === 'anthropic' ? 'api.anthropic.com' : 'the host in your base URL';
  $('cloud-notice').textContent = `By confirming, you agree that your prompts, tool results and any attached image are sent to ${host}. The key is kept in memory only and cleared on reload or New chat.`;
  $('cloud-model').placeholder = cloudProvider() === 'anthropic' ? 'claude-opus-5-5 (cheaper: claude-sonnet-5-5, claude-haiku-5-5)' : 'model name served by this endpoint';
  $('cloud-base-row').hidden = cloudProvider() !== 'openai';
  $('cloud-effort').hidden = cloudProvider() !== 'anthropic';
  if (cloudProvider() === 'anthropic' && !$('cloud-model').value.trim()) $('cloud-model').value = 'claude-opus-5-5';
}
for (const radio of document.querySelectorAll('input[name="cloud-provider"]')) radio.addEventListener('change', cloudNotice);
$('cloud-use').addEventListener('click', () => {
  error('');
  try {
    const { host } = cloud.configure({ provider: cloudProvider(), model: $('cloud-model').value, baseUrl: $('cloud-base').value.trim() || null, key: $('cloud-key').value, effort: $('cloud-effort-select').value });
    $('cloud-key').value = ''; // the key never lingers in the DOM after opt-in
    status(`Cloud model ready. Your prompts are sent to ${host}.`);
    bindClient(); controls();
  } catch (err) { error(err.message); }
});
$('message').addEventListener('keydown', event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); $('composer').requestSubmit(); } });
for (const button of document.querySelectorAll('[data-prompt]')) button.addEventListener('click', () => { $('message').value = button.dataset.prompt; $('message').focus(); });
function download(name, value) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$('export').addEventListener('click', () => { download('ai-agent-conversation.json', { version: 1, ...session.snapshot(), savedAt: Date.now() }); session.exportedRevision = session.revision; });
$('raw-export').addEventListener('click', async () => { try { download('ai-agent-stored-data.json', await store.raw()); } catch (err) { storageError(err.message); } });
$('retry-save').addEventListener('click', () => session.persist());
$('settings').addEventListener('click', () => $('settings-dialog').showModal());
$('close-settings').addEventListener('click', () => $('settings-dialog').close());
$('import').addEventListener('click', () => $('file').click());
async function replaceConversation(value) {
  const valid = validateConversation(value);
  if (!confirm('Open this conversation? The current stored record will be kept for recovery.')) return;
  cancel(); error(''); await session.newChat(valid); $('settings-dialog').close(); controls();
}
$('file').addEventListener('change', async () => {
  const file = $('file').files[0]; $('file').value = ''; if (!file) return;
  try { if (file.size > 5_000_000) throw new Error('Backups must be smaller than 5 MB.'); const data = JSON.parse(await file.text()); await replaceConversation(data.history ? data : data.current ?? data.legacy ?? data.previous); }
  catch (err) { error(`Backup was not opened: ${err.message}`); $('settings-dialog').close(); }
});
$('previous').addEventListener('click', async () => { try { const raw = await store.raw(); if (!raw.previous) throw new Error('No previous record is stored.'); await replaceConversation(raw.previous); } catch (err) { error(err.message); $('settings-dialog').close(); } });
// Accept desktop messages only from the same-origin parent. No conversation data is posted to it.
const theme = value => { document.documentElement.dataset.theme = value === 'light' ? 'light' : 'dark'; };
try { theme(localStorage.getItem('theme') ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')); } catch { theme('dark'); }
addEventListener('message', event => { if (event.origin === location.origin && event.source === parent && event.data?.type === 'pc:theme') theme(event.data.theme); });
document.addEventListener('pointerdown', () => { if (parent !== window) parent.postMessage({ type: 'pc:focus', appId: 'ai-agent' }, location.origin); }, true);
if (parent !== window) parent.postMessage({ type: 'pc:ready', appId: 'ai-agent' }, location.origin);
const unsaved = () => Boolean(store.pending) || (session.savedRevision < session.revision && session.exportedRevision !== session.revision);
window.pcFlush = () => {
  if (!initialized) { error('Wait for stored data to finish opening before closing.'); return false; }
  if (unsaved()) { error(store.pending ? 'Saving is still in progress. Try closing again after it completes.' : 'This chat could not be saved. Retry save or Export before closing.'); return false; }
  return true;
};
window.pcBeforeClose = () => { cancel('App closed. Load the model again to continue.'); $('reader-proxy').checked = false; cloud.clear(); indexAbort = null; searchHost.dispose(); embedClient.stop(); fileGrants.length = 0; bindClient(); return window.pcFlush(); };
addEventListener('beforeunload', event => { if (unsaved()) { event.preventDefault(); event.returnValue = ''; } });
addEventListener('pagehide', () => { loadVersion++; cloud.clear(); indexAbort = null; searchHost.dispose(); embedClient.stop(); fileGrants.length = 0; session.cancel(); });
modelInfo(); cloudNotice(); bindClient(); controls();
try {
  const { value, migrated } = await store.restore(); session.history = value.history; session.summary = value.summary; render(value);
  if (migrated) status('Previous conversation copied safely. The original record was kept. Load a model to continue.');
} catch (err) { storageError(`Could not restore stored data: ${err.message}`); }
initialized = true; controls();
if (!navigator.gpu) status('WebGPU is unavailable here. You can still read, export, and recover saved conversations.');
