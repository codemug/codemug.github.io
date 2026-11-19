import { ModelClient } from './model-client.js';
import { AgentSession } from './session.js';
import { ConversationStore, validateConversation, MODEL_KEY, LEGACY_MODEL_KEY } from './storage.js';
import { MODELS, DEFAULT_MODEL } from './models.js';
import { webSearch, httpGet } from './web.js';
import { runJavaScript } from './sandbox.js';
const $ = id => document.getElementById(id);
const store = new ConversationStore(); let initialized = false, loading = false, loadVersion = 0, selected = DEFAULT_MODEL;
try { const saved = localStorage.getItem(MODEL_KEY) ?? localStorage.getItem(LEGACY_MODEL_KEY); if (MODELS[saved]) selected = saved; } catch {}
for (const [key, model] of Object.entries(MODELS)) $('model').add(new Option(`${model.label} · ${model.size}`, key));
$('model').value = selected;
const status = text => { $('status').textContent = text; };
const error = text => { $('error').textContent = text; $('error').hidden = !text; };
function storageError(text) { $('storage-warning').hidden = false; $('storage-warning').querySelector('span').textContent = `${text} Your chat is still in memory; export it before closing.`; $('save-state').textContent = 'Not saved — export your chat'; }
function controls() {
  $('load-model').disabled = !initialized || loading || Boolean(session.active) || client.ready;
  $('stop').disabled = !(loading || session.active || client.ready);
  $('send').disabled = !initialized || !client.ready || Boolean(session.active) || loading;
  $('new-chat').disabled = !initialized; $('import').disabled = !initialized; $('previous').disabled = !initialized;
  $('model-state').textContent = loading ? 'Loading…' : client.ready ? session.active ? 'Working locally' : 'Ready · on device' : 'Not loaded';
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
const session = new AgentSession({ client, store, webSearch, httpGet, runJavaScript, proxyAllowed: () => $('reader-proxy').checked, emit(type, data) {
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
function cancel(text = 'Stopped. Load the model again to continue; cached downloads are kept.') {
  loadVersion++; loading = false; session.cancel(); $('progress').hidden = true;
  document.querySelectorAll('.message-body:empty').forEach(el => { el.textContent = 'Stopped.'; });
  document.querySelectorAll('.tool summary').forEach(el => { if (el.textContent.endsWith('· running')) el.textContent = el.textContent.replace('· running', '· stopped'); });
  controls(); status(text);
}
function modelInfo() {
  const model = MODELS[selected];
  $('download-note').textContent = `Load ${model.label} when ready: ${model.size} of model files from Hugging Face. No model files download automatically. Chat and computation stay on device; web tools make the requests you ask for.`;
  const link = document.createElement('a'); link.href = `https://huggingface.co/${model.repo}/tree/${model.revision}`; link.target = '_blank'; link.rel = 'noopener'; link.textContent = `${model.label} · ${model.license}`;
  $('model-license').replaceChildren(link, document.createTextNode('. Model weights have their own license. Sizes are approximate; small models may miss tools or return incorrect answers.'));
}
$('load-model').addEventListener('click', async () => {
  cancel(); const version = ++loadVersion; loading = true; controls(); error(''); $('progress').hidden = false; $('progress').removeAttribute('value'); status('Checking WebGPU…');
  try {
    if (!navigator.gpu) throw new Error('WebGPU is unavailable. Use a compatible browser/device with hardware acceleration. Your saved conversation is still available.');
    const adapter = await navigator.gpu.requestAdapter();
    if (version !== loadVersion) return;
    if (!adapter) throw new Error('No WebGPU adapter is available. Your saved conversation is still available.');
    if (!adapter.features.has('shader-f16')) throw new Error('This WebGPU device does not support shader-f16, required by these models.');
    status(`Loading ${MODELS[selected].label} · first download ${MODELS[selected].size}…`);
    await client.load(selected); if (version !== loadVersion) return;
    status('Model ready. Messages are processed on this device.'); $('message').focus();
  } catch (err) { if (version === loadVersion && err.name !== 'AbortError') error(err.message); }
  finally { if (version === loadVersion) { loading = false; $('progress').hidden = true; controls(); } }
});
$('stop').addEventListener('click', () => cancel());
$('model').addEventListener('change', () => { cancel('Model changed. Load it when you’re ready.'); selected = $('model').value; try { localStorage.setItem(MODEL_KEY, selected); } catch {} modelInfo(); });
$('new-chat').addEventListener('click', async () => {
  if ((session.history.length || session.active) && !confirm('Start a new chat? The current stored chat will be kept as the previous record. Export it first if you need a permanent copy.')) return;
  cancel(); error(''); await session.newChat(); controls(); $('message').focus();
});
$('composer').addEventListener('submit', async event => {
  event.preventDefault(); if ($('send').disabled) return;
  const text = $('message').value; if (!text.trim()) return;
  $('message').value = ''; error('');
  try { await session.send(text); } catch (err) { error(err.message); } controls();
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
window.pcBeforeClose = () => { cancel('App closed. Load the model again to continue.'); $('reader-proxy').checked = false; return window.pcFlush(); };
addEventListener('beforeunload', event => { if (unsaved()) { event.preventDefault(); event.returnValue = ''; } });
addEventListener('pagehide', () => { loadVersion++; session.cancel(); });
modelInfo(); controls();
try {
  const { value, migrated } = await store.restore(); session.history = value.history; session.summary = value.summary; render(value);
  if (migrated) status('Previous conversation copied safely. The original record was kept. Load a model to continue.');
} catch (err) { storageError(`Could not restore stored data: ${err.message}`); }
initialized = true; controls();
if (!navigator.gpu) status('WebGPU is unavailable here. You can still read, export, and recover saved conversations.');
