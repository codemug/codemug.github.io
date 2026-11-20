import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SerializeAddon } from '@xterm/addon-serialize';
import '@xterm/xterm/css/xterm.css';
import { setupApp, download } from './common.mjs';
import { packCheckpoint, unpackCheckpoint } from './linux-checkpoint.mjs';
import { readSession, writeSession } from './linux-store.mjs';
import { validateExecRequest, buildExecCommand, findSentinel, parseExecResult, parseExecPartial, isAtShellPrompt, toSentBytes, randomNonce, visibleCode, handleExecChannelMessage, MAX_OUTPUT } from './terminal-exec.mjs';
const $ = selector => document.querySelector(selector);
const base = new URL('/pc/vendor/terminal/', location.href).href;
const term = new Terminal({ cursorBlink: true, fontFamily: getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim(), fontSize: 13, scrollback: 1200 });
const fit = new FitAddon(), serialize = new SerializeAddon();
term.loadAddon(fit); term.loadAddon(serialize); term.open($('#terminal'));
let active = null, running = false, busy = false, booted = false, dirty = false, saved = null, release = null, outputTail = '', bootTimer;
let exec = null; // { phase:'prompt'|'run', req, sentCommand?, nonce?, buffer?, done?, trimmed?, timer?, startedAt? } — one exec slot at a time
let requestId = 0;
const report = (text, error = false) => { $('#terminal-status').textContent = text; $('#terminal-status').dataset.error = String(error); };
const flushScreen = () => new Promise(resolve => term.write('', resolve));
function controls() {
  const blocked = busy || exec !== null;
  $('#linux-start').disabled = blocked || !!active;
  $('#linux-pause').disabled = blocked || !active; $('#linux-pause').textContent = running ? 'Pause' : 'Resume';
  $('#linux-restart').disabled = blocked || !active;
  for (const id of ['save', 'export']) $(`#linux-${id}`).disabled = blocked || !active || !booted;
  $('#linux-restore').disabled = blocked || !saved;
  $('#linux-import').disabled = blocked;
  $('#linux-fit').disabled = blocked || !active || !booted || !running;
  document.querySelectorAll('[data-linux-key]').forEach(button => button.disabled = blocked || !active || !running);
}
async function manifest() {
  if (!release) { const response = await fetch(`${base}release.json`); if (!response.ok) throw new Error('Linux is temporarily unavailable. Reload the page or try again later.'); release = await response.json(); }
  return release;
}
function spawn(checkpoint) {
  const worker = new Worker(new URL('./linux.worker.js', import.meta.url), { type: 'module' });
  const pending = new Map(); let resolveReady, rejectReady;
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  const client = { worker, ready, request(type) { return new Promise((resolve, reject) => { const id = ++requestId; pending.set(id, { resolve, reject }); worker.postMessage({ type, id }); }); }, stop() { worker.terminate(); pending.forEach(({ reject }) => reject(new Error('Linux worker stopped.'))); pending.clear(); } };
  const decoder = new TextDecoder();
  worker.onmessage = ({ data }) => {
    if (data.type === 'initialized') resolveReady(client);
    else if (data.type === 'output' && active === client) {
      const text = decoder.decode(data.bytes, { stream: true });
      term.write(data.bytes); outputTail = (outputTail + text).slice(-3000); feedExec(text);
      if (!booted && /webpc:[^\r\n]*# /.test(outputTail)) { booted = true; clearTimeout(bootTimer); report('Linux is running · offline · save a session to keep your work.'); controls(); }
    } else if (data.type === 'error') {
      rejectReady(new Error(data.message));
      if (data.id && pending.has(data.id)) { pending.get(data.id).reject(new Error(data.message)); pending.delete(data.id); }
      else if (active === client) report(`Linux error: ${data.message}. Your saved checkpoint is unchanged.`, true);
    } else if (data.id && pending.has(data.id)) { pending.get(data.id).resolve(data); pending.delete(data.id); }
  };
  worker.onerror = event => { const error = new Error(event.message || 'Linux worker failed.'); rejectReady(error); pending.forEach(({ reject }) => reject(error)); pending.clear(); if (active === client) report(error.message, true); };
  worker.postMessage({ type: 'init', base, checkpoint, vm: release.vm });
  return client;
}
async function replace(checkpoint = null) {
  const previous = active, wasRunning = running, wasBooted = booted, wasDirty = dirty;
  const previousScreen = previous ? serialize.serialize({ scrollback: 800 }) : null;
  let candidate;
  try {
    if (previous && wasRunning) await previous.request('pause');
    report(checkpoint ? 'Checking and restoring Linux checkpoint…' : 'Loading Linux assets…');
    candidate = spawn(checkpoint); await candidate.ready;
    await candidate.request('run');
    active = candidate; running = true; booted = !!checkpoint; dirty = true; outputTail = ''; clearTimeout(bootTimer);
    term.reset();
    if (checkpoint) { term.resize(checkpoint.header.cols, checkpoint.header.rows); term.write(checkpoint.header.screen); await flushScreen(); }
    fit.fit(); term.focus(); previous?.stop();
    report(checkpoint ? 'Checkpoint restored · Linux is running offline.' : 'Booting Alpine Linux… first boot can take up to a minute.');
    if (!checkpoint) bootTimer = setTimeout(() => { if (!booted) report('Linux is still booting. You can pause or restart it if startup does not complete.', true); }, 90000);
  } catch (error) {
    candidate?.stop(); active = previous; running = wasRunning; booted = wasBooted; dirty = wasDirty;
    if (previousScreen !== null) { term.reset(); term.write(previousScreen); }
    if (previous && wasRunning) await previous.request('run').catch(() => {});
    throw error;
  }
}
async function action(callback) {
  if (busy) return; busy = true; controls();
  try { await callback(); } catch (error) { report(error.message || String(error), true); }
  finally { busy = false; controls(); }
}
async function capture(exportOnly) {
  const wasRunning = running;
  report('Capturing Linux memory and files… this may take several seconds.');
  try {
    const snapshot = await active.request('save'); running = false; await flushScreen();
    const meta = await manifest();
    const header = { version: 1, imageId: meta.imageId, runtime: meta.v86, createdAt: new Date().toISOString(), rawBytes: snapshot.rawBytes, sha256: snapshot.sha256, screen: serialize.serialize({ scrollback: 800 }), cols: term.cols, rows: term.rows };
    const blob = packCheckpoint(header, snapshot.payload);
    if (exportOnly) download('webpc-linux.webpcvm', blob, 'application/octet-stream');
    else {
      try { await writeSession(blob); saved = blob; }
      catch (error) { throw new Error(`Could not save in this browser. Export session now to keep your work. ${error.message || ''}`); }
    }
    dirty = false;
    report(`${exportOnly ? 'Exported' : 'Saved in this browser'} · ${(blob.size / 1048576).toFixed(1)} MB · ${new Date().toLocaleTimeString()}. ${wasRunning ? 'Linux continues running; later changes need another save.' : 'Linux is paused.'}`);
  } finally {
    if (wasRunning) { await active.request('run'); running = true; dirty = true; }
  }
}
$('#linux-start').onclick = () => action(async () => { await manifest(); await replace(); });
$('#linux-pause').onclick = () => action(async () => {
  await active.request(running ? 'pause' : 'run'); running = !running; if (running) dirty = true;
  report(running ? 'Linux resumed · changes since your checkpoint are not saved.' : 'Linux paused · memory is retained until this page closes.'); term.focus();
});
$('#linux-restart').onclick = () => action(async () => { if (confirm('Start a clean Linux guest? Unsaved work in this session will be lost. Your saved checkpoint stays intact.')) await replace(); });
$('#linux-save').onclick = () => action(() => capture(false));
$('#linux-export').onclick = () => action(() => capture(true));
async function restore(blob) {
  const { imageId } = await manifest(); const checkpoint = await unpackCheckpoint(blob, imageId);
  if (active && !confirm('Replace the current Linux session with this checkpoint? Export any unsaved work first.')) return;
  await replace(checkpoint);
}
$('#linux-restore').onclick = () => action(() => restore(saved));
$('#linux-import').onclick = () => $('#linux-backup').click();
$('#linux-backup').onchange = event => { const file = event.target.files[0]; event.target.value = ''; if (file) action(() => restore(file)); };
const input = text => { if (exec !== null) return; if (!busy && active && running) { active.worker.postMessage({ type: 'input', text }); dirty = true; } };
term.onData(input);
$('#linux-fit').onclick = () => { if (confirm(`At an idle shell prompt? Run stty rows ${term.rows} cols ${term.cols}. Do not send this inside an active program.`)) { input(`stty rows ${term.rows} cols ${term.cols}\r`); term.focus(); } };
for (const button of document.querySelectorAll('[data-linux-key]')) button.onclick = () => { input({ interrupt: '\x03', tab: '\t', escape: '\x1b' }[button.dataset.linuxKey]); term.focus(); };
$('#linux-help').onclick = () => { const hidden = !$('#linux-help-panel').hidden; $('#linux-help-panel').hidden = hidden; $('#linux-help').setAttribute('aria-expanded', String(!hidden)); };
try { $('#linux-legacy').hidden = localStorage.getItem('pc:terminal:v1') === null; } catch { /* No access to legacy storage. */ }
$('#linux-legacy').onclick = () => { try { const raw = localStorage.getItem('pc:terminal:v1'); if (raw !== null) download('webpc-legacy-files.json', raw); } catch { report('Legacy browser storage is unavailable.', true); } };
// Exec service: other same-origin pages post {type:'exec-request', id, from, lang, code,
// timeoutMs} on BroadcastChannel('webpc-terminal'). Any same-origin page (including
// third-party bundles) can post, so every run needs a visible approval click; one run at
// a time; output is captured between the per-run marker and sentinel lines (see
// terminal-exec.mjs). Protocol replies: exec-pending (prompt shown), exec-started (Run
// clicked), exec-cancel (withdraw a waiting prompt); another Terminal's exec-started for
// the same id withdraws this prompt silently. Replies are never answered.
const execChannel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('webpc-terminal');
const execRespond = message => execChannel?.postMessage(message);
function handleExecRequest(data) {
  if (data?.type !== 'exec-request') return; // non-requests (replies, other apps) get no answer: answering them loops between two Terminals
  const check = validateExecRequest(data);
  if (!check.ok) { if (typeof data?.id === 'string' && data.id.length <= 200) execRespond({ type: 'exec-error', id: data.id, reason: 'invalid' }); return; }
  if (exec !== null) { execRespond({ type: 'exec-error', id: check.id, reason: 'busy' }); return; }
  if (!active || !running || !booted) { execRespond({ type: 'exec-error', id: check.id, reason: 'not-running' }); return; }
  exec = { phase: 'prompt', req: check };
  execRespond({ type: 'exec-pending', id: check.id });
  $('#exec-meta').textContent = `From: ${check.from} · Language: ${check.lang}`;
  $('#exec-code').textContent = visibleCode(check.code);
  $('#exec-prompt').hidden = false;
  $('#exec-deny').focus();
  report(`A command from ${check.from} is waiting for your approval.`);
  controls();
}
execChannel?.addEventListener('message', event => {
  const decision = handleExecChannelMessage(event.data, exec);
  if (decision.action === 'withdraw') {
    // Another Terminal started (or cancelled) the command this one is prompting for:
    // withdraw silently — no reply, no run.
    exec = null; $('#exec-prompt').hidden = true; controls();
    report('Another Terminal is running this command first.');
    return;
  }
  if (decision.action !== 'request') return;
  handleExecRequest(event.data);
});
$('#exec-deny').onclick = () => {
  const slot = exec; if (!slot || slot.phase !== 'prompt') return;
  exec = null; $('#exec-prompt').hidden = true; controls();
  execRespond({ type: 'exec-error', id: slot.req.id, reason: 'denied' });
  report('Command denied — nothing was run.');
};
$('#exec-run').onclick = event => {
  if (!event.isTrusted) return; // a programmatic click is not an approval
  const slot = exec; if (!slot || slot.phase !== 'prompt') return;
  $('#exec-prompt').hidden = true;
  execRespond({ type: 'exec-started', id: slot.req.id });
  void runExec(slot.req);
};
async function runExec(req) {
  // Early returns still release the slot, the toolbar and the status — nothing may stay
  // stuck on "waiting for your approval".
  const fail = reason => { exec = null; execRespond({ type: 'exec-error', id: req.id, reason }); report(reason === 'busy' ? 'The shell is not idle, so the command was not run. Try again when it is.' : 'Linux is not running, so the command was not run. Start Linux first.', true); controls(); };
  if (!isAtShellPrompt(outputTail)) { fail('busy'); return; }
  if (!active || !running) { fail('not-running'); return; }
  const nonce = randomNonce();
  const sentCommand = buildExecCommand(req.id, req.lang, req.code, nonce);
  const slot = { phase: 'run', req, sentCommand, nonce, buffer: '', done: false, trimmed: false, timer: null, startedAt: Date.now() };
  exec = slot;
  report(`Running ${req.lang} command from ${req.from}… your keystrokes are ignored until it finishes.`);
  controls();
  slot.timer = setTimeout(() => { void onExecTimeout(slot); }, req.timeoutMs);
  active.worker.postMessage({ type: 'input', text: toSentBytes(sentCommand) });
}
function feedExec(text) {
  const slot = exec;
  if (!slot || slot.phase !== 'run' || slot.done) return;
  slot.buffer += text;
  if (slot.buffer.length > 524288) { slot.buffer = slot.buffer.slice(-524288); slot.trimmed = true; }
  if (findSentinel(slot.buffer, slot.req.id, slot.nonce)) finishExec(slot);
}
function finishExec(slot) {
  if (slot.done) return;
  slot.done = true; clearTimeout(slot.timer);
  const result = parseExecResult(slot.buffer, slot.req.id, slot.req.lang, slot.nonce);
  const durationMs = Date.now() - slot.startedAt;
  exec = null;
  report(`Command finished · exit ${result.exitCode} · ${durationMs} ms${result.truncated || slot.trimmed ? ' · output truncated' : ''}.`);
  controls();
  execRespond({ type: 'exec-result', id: slot.req.id, exitCode: result.exitCode, output: result.output, truncated: result.truncated || slot.trimmed, durationMs });
}
async function onExecTimeout(slot) {
  if (slot.done) return;
  if (active) active.worker.postMessage({ type: 'input', text: '\x03' }); // Ctrl+C, then wait for the shell prompt
  const deadline = Date.now() + 10000;
  while (!slot.done && Date.now() < deadline) { if (isAtShellPrompt(outputTail)) break; await new Promise(resolve => setTimeout(resolve, 250)); }
  if (slot.done) return;
  slot.done = true; clearTimeout(slot.timer);
  const durationMs = Date.now() - slot.startedAt;
  exec = null;
  // Partial output: the same normalization and cut as a normal result — after the
  // OUT marker line that every language's run line prints (or empty if it never
  // arrived) — minus the trailing shell prompt and blank-line artifacts (see
  // parseExecPartial).
  let output = parseExecPartial(slot.buffer, slot.req.id, slot.req.lang, slot.nonce);
  const truncated = slot.trimmed || output.length > MAX_OUTPUT;
  if (output.length > MAX_OUTPUT) output = output.slice(-MAX_OUTPUT);
  report('Command timed out and was interrupted (Ctrl+C).', true);
  controls();
  execRespond({ type: 'exec-error', id: slot.req.id, reason: 'timeout', output, truncated, durationMs });
}
window.pcBeforeClose = () => {
  if (exec?.phase === 'run' && !exec.done) { report('A command is still running. Wait for it to finish or time out before closing.', true); return false; }
  if (busy) { report('Wait for the current Linux session operation to finish before closing.', true); return false; }
  if (active && dirty && !confirm('Hide Linux without saving a new checkpoint? This page keeps its memory, but a refresh loses changes.')) return false;
  if (active && running) { active.request('pause').catch(error => report(error.message, true)); running = false; report('Linux paused while hidden. Resume to continue.'); controls(); }
  return true;
};
window.addEventListener('beforeunload', event => { if (active && dirty || busy) { event.preventDefault(); event.returnValue = ''; } });
new ResizeObserver(() => { try { fit.fit(); } catch { /* Hidden desktop window. */ } }).observe($('#terminal'));
setupApp('terminal', () => { const css = getComputedStyle(document.documentElement); term.options.theme = { background: css.getPropertyValue('--color-bg').trim(), foreground: css.getPropertyValue('--color-text').trim(), cursor: css.getPropertyValue('--color-accent').trim() }; });
requestAnimationFrame(() => fit.fit());
readSession().then(blob => { saved = blob; controls(); if (blob && !active && !busy) report('A saved Linux checkpoint is available. Restore saved to continue, or start a clean guest.'); }).catch(() => report('Browser storage is unavailable. You can run Linux and export checkpoints to a file.', true));
controls();
