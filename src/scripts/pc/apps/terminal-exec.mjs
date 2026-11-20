// Pure helpers for the terminal exec service (BroadcastChannel('webpc-terminal'),
// wired up in terminal.mjs). No DOM and no worker here, so every rule is unit-tested
// in tests/pc-terminal-exec.test.mjs.

export const MAX_OUTPUT = 64 * 1024;
export const MAX_CODE = 64 * 1024;
export const MAX_TIMEOUT_MS = 120000;
export const DEFAULT_TIMEOUT_MS = 30000;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/; // shell-safe: it lands in command text and /tmp file names
const NONCE_RE = /^[0-9a-f]{16}$/;
const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const CHUNK_CHARS = 2000; // per printf line: short enough to type, long enough to keep the run small

export function validateExecRequest(data) {
  if (!data || typeof data !== 'object') return { ok: false };
  const { id, from, lang, code, timeoutMs } = data;
  if (typeof id !== 'string' || !ID_RE.test(id)) return { ok: false };
  if (typeof from !== 'string' || from.length === 0 || from.length > 200) return { ok: false };
  if (lang !== 'sh' && lang !== 'python' && lang !== 'node') return { ok: false };
  if (typeof code !== 'string' || code.length > MAX_CODE) return { ok: false };
  let timeout = DEFAULT_TIMEOUT_MS;
  if (timeoutMs !== undefined) {
    if (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS) return { ok: false };
    timeout = Math.round(timeoutMs);
  }
  return { ok: true, id, from, lang, code, timeoutMs: timeout };
}

// Per-run nonce: the Terminal generates it with crypto.getRandomValues. It lands in the
// output marker and the sentinel, so code that runs cannot fake its own end marker with
// the request id (which is visible in the /tmp file names). 16 lowercase hex characters.
export function randomNonce(cryptoObj = globalThis.crypto) {
  const bytes = cryptoObj.getRandomValues(new Uint8Array(8));
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out;
}

// Platform-independent base64 (TextEncoder bytes + the standard alphabet): the code's
// UTF-8 bytes as [A-Za-z0-9+/=] only, so no control, quote or shell metacharacter can
// reach the tty inside a sent command line.
export function base64Encode(text) {
  const bytes = new TextEncoder().encode(text);
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i], b = bytes[i + 1] ?? 0, c = bytes[i + 2] ?? 0;
    out += B64_ALPHABET[a >> 2] + B64_ALPHABET[((a & 3) << 4) | (b >> 4)] + (i + 1 < bytes.length ? B64_ALPHABET[((b & 15) << 2) | (c >> 6)] : '=') + (i + 2 < bytes.length ? B64_ALPHABET[c & 63] : '=');
  }
  return out;
}

// What actually goes out on the serial line: the tty submits on CR, so every \n
// (line feed we built the command with) becomes a CR, plus a final CR that submits
// the last line.
export function toSentBytes(sentCommand) {
  return sentCommand.replace(/\n/g, '\r') + '\r';
}

// The sentinel the run line prints after the interpreter exits: a standalone line that
// delimits the captured output and carries the exit code ($? is an unquoted printf
// argument, expanded by the guest shell; id and nonce are shell-safe by construction).
function sentinelBody(id, nonce) { return `printf '\\n__WEBPC_END_%s_%s_%d__\\n' ${id} ${nonce} $?`; }

// The code is never typed into the shell: raw code in bash readline submits mid-line on
// a raw \r, TAB triggers completion, Ctrl+P/R and ESC rewrite the line, \x03/\x04 escape
// structures, and !x may hit history expansion. Instead the code's bytes are base64 and
// sent as short single-quoted printf lines into a .b64 file, decoded to a file, and run
// by its interpreter — sh included, now from a file, so a trailing newline or a trailing
// "# comment" is just file content. Every language's run line starts by printing the
// __WEBPC_OUT_<id>_<nonce>__ marker on its own line, before the interpreter runs.
export function buildExecCommand(id, lang, code, nonce) {
  if (typeof nonce !== 'string' || !NONCE_RE.test(nonce)) throw new Error('buildExecCommand needs a 16-hex-char per-run nonce');
  const ext = { sh: 'sh', python: 'py', node: 'js' }[lang];
  const interpreter = { sh: 'bash', python: 'python3', node: 'node' }[lang];
  const b64 = base64Encode(code);
  const lines = [`: > /tmp/webpc-${id}.b64`];
  for (let i = 0; i < b64.length; i += CHUNK_CHARS) lines.push(`printf %s '${b64.slice(i, i + CHUNK_CHARS)}' >> /tmp/webpc-${id}.b64`);
  lines.push(`base64 -d /tmp/webpc-${id}.b64 > /tmp/webpc-${id}.${ext}`);
  lines.push(`echo __WEBPC_OUT_${id}_${nonce}__ ; ${interpreter} /tmp/webpc-${id}.${ext}; ${sentinelBody(id, nonce)}`);
  return lines.join('\n');
}

// The guest's PS1 is `webpc:<dir># `; the serial output tail ends there when the
// shell is idle. Anchored at the end (the boot check uses the same pattern).
export function isAtShellPrompt(tail) {
  return /webpc:[^\r\n]*# [\r\n\s]*$/.test(tail);
}

// The sentinel line, anchored: `__WEBPC_END_<id>_<nonce>_<0-255>__` alone on a line.
// Similar text (other ids or nonces, codes above 255, un-anchored, unterminated) never
// matches — the per-run nonce is what a running command cannot know.
export function findSentinel(buffer, id, nonce) {
  const re = new RegExp(`(^|\\n)__WEBPC_END_${id}_${nonce}_(\\d{1,3})__(?=\\r?\\n|$)`, 'g');
  let match;
  while ((match = re.exec(buffer)) !== null) {
    const exitCode = Number(match[2]);
    if (exitCode <= 255) return { exitCode, index: match.index + match[1].length, length: match[0].length - match[1].length };
  }
  return null;
}

export function stripAnsi(text) {
  return text
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')  // CSI sequences
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '') // terminated OSC sequences
    .replace(/\x1b[@-Z\\-_]/g, '') // other two-byte escapes
    .replace(/[\x00-\x08\x0b\x0e-\x1f]/g, ''); // C0 controls, keep \t \n \r
}

// Index of a line consisting exactly of `line` (line-anchored: the run line's echo
// contains the marker as a substring but not as a line). With `last`, the last such
// line — the output cut must not stop at an earlier occurrence.
export function findOwnLine(text, line, last = false) {
  const re = new RegExp(`(^|\\n)${line.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=\\r?\\n|$)`, 'g');
  let match, start = -1;
  while ((match = re.exec(text)) !== null) { start = match.index + match[1].length; if (!last) break; }
  return start;
}

// Where the command's own output begins, in normalized text (ANSI stripped, CRs→LFs):
// the guest echoes each sent CR as a bare \r byte (plus a bare-\r blank line) and wraps
// long lines at the console width, so the echo is useless as a cut point. Every
// language's run line prints __WEBPC_OUT_<id>_<nonce>__ on its own line before the
// interpreter runs — the cut is after the LAST such line.
export function cutStart(text, id, nonce) {
  const marker = `__WEBPC_OUT_${id}_${nonce}__`;
  const start = findOwnLine(text, marker, true);
  if (start >= 0) return start + marker.length + 1; // +1 skips the \n of the marker line
  return 0;
}

// output = everything before the sentinel line, from cutStart on. The text is
// normalized first (ANSI stripped, CRs→LFs) because the guest's CR echo is bare \r.
// One leading newline (CR-echo artifact) and one trailing newline (the sentinel's
// own leading newline) are stripped; bounded to 64 KB (the tail is kept).
export function parseExecResult(buffer, id, lang, nonce) {
  const found = findSentinel(buffer, id, nonce);
  if (!found) return null;
  const pre = stripAnsi(buffer.slice(0, found.index)).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  let output = pre.slice(cutStart(pre, id, nonce));
  if (output.startsWith('\n')) output = output.slice(1);
  if (output.endsWith('\n')) output = output.slice(0, -1);
  let truncated = false;
  if (output.length > MAX_OUTPUT) { output = output.slice(-MAX_OUTPUT); truncated = true; }
  return { exitCode: found.exitCode, output, truncated };
}

// Partial output for the timeout path: the same normalization and cut as a normal
// result — after the last OUT marker line (every language prints one; empty if the
// marker never arrived). Then drop the trailing shell prompt (printed after the
// Ctrl+C) and surrounding blank lines.
export function parseExecPartial(buffer, id, lang, nonce) {
  const text = stripAnsi(buffer).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const marker = `__WEBPC_OUT_${id}_${nonce}__`;
  const start = findOwnLine(text, marker, true);
  let output = start >= 0 ? text.slice(start + marker.length + 1) : '';
  const prompt = output.match(/\n?webpc:[^\n]*# [^\n]*$/);
  if (prompt) output = output.slice(0, output.length - prompt[0].length);
  return output.trim();
}

// The approval prompt shows exactly what will run: C0 controls, DEL and
// bidi/zero-width characters render as escapes (\x0d, <U+202E>) instead of being
// invisible, so crafted code cannot masquerade. Newlines stay newlines.
const CONTROL_RE = /[\u0000-\u0008\u0009\u000B-\u001F\u007F]/g;
const INVISIBLE_RE = /[\u200B\u200C\u200D\u200E\u200F\u202A\u202B\u202C\u202D\u202E\u2060\u2066\u2067\u2068\u2069\uFEFF]/g;
export function visibleCode(code) {
  return code
    .replace(CONTROL_RE, ch => `\\x${ch.charCodeAt(0).toString(16).padStart(2, '0')}`)
    .replace(INVISIBLE_RE, ch => `<U+${ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}>`);
}

// Channel-message triage for the exec protocol: an 'exec-request' goes to the approval
// flow; another Terminal's 'exec-started' or 'exec-cancel' for the id this Terminal is
// still prompting for withdraws that prompt silently (no reply). Everything else —
// including the replies this Terminal posts itself and other apps' traffic — must be
// ignored: answering a non-request message is what made two Terminals bounce
// exec-error replies forever.
export function handleExecChannelMessage(data, slot) {
  if (data?.type === 'exec-request') return { action: 'request' };
  if ((data?.type === 'exec-started' || data?.type === 'exec-cancel') && typeof data.id === 'string' && slot && slot.phase === 'prompt' && slot.req?.id === data.id) {
    return { action: 'withdraw' };
  }
  return { action: 'ignore' };
}
