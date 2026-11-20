// Pure helpers for the terminal exec service (BroadcastChannel('webpc-terminal'),
// wired up in terminal.mjs). No DOM and no worker here, so every rule is unit-tested
// in tests/pc-terminal-exec.test.mjs.

export const MAX_OUTPUT = 64 * 1024;
export const MAX_CODE = 64 * 1024;
export const MAX_TIMEOUT_MS = 120000;
export const DEFAULT_TIMEOUT_MS = 30000;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/; // shell-safe: it lands in command text and /tmp file names

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

function randomLetter() { return String.fromCharCode(97 + Math.floor(Math.random() * 26)); }

// Heredoc terminator that does not occur anywhere in the code (a heredoc ends at a
// line equal to it, so a substring collision is already conservative). Regenerated
// on collision. `random` is injectable for the collision test.
export function pickMarker(code, random = randomLetter) {
  for (let attempt = 0; attempt < 256; attempt++) {
    let marker = 'WEBPC_EOF_';
    for (let i = 0; i < 8; i++) marker += random();
    if (!code.includes(marker)) return marker;
  }
  throw new Error('Could not pick a heredoc marker that does not occur in the code.');
}

// What actually goes out on the serial line: the tty submits on CR, so every \n
// (line feed we built the command with) becomes a CR, plus a final CR that submits
// the last line. The tty echoes these bytes back, so this is also the echo to strip.
export function toSentBytes(sentCommand) {
  return sentCommand.replace(/\n/g, '\r') + '\r';
}

// The sentinel is a standalone line printf appends after every command: it delimits
// the captured output and carries the exit code ($? is an unquoted printf argument,
// expanded by the guest shell; <id> is shell-safe by validation).
function sentinelBody(id) { return `printf '\\n__WEBPC_END_%s_%d__\\n' ${id} $?`; }

export function buildExecCommand(id, lang, code) {
  const sentinel = `; ${sentinelBody(id)}`;
  if (lang === 'sh') return code ? code + sentinel : sentinelBody(id);
  const marker = pickMarker(code);
  const file = `/tmp/webpc-${id}.${lang === 'python' ? 'py' : 'js'}`;
  // The run line starts by printing an output marker: the interactive echo of a
  // heredoc interleaves shell prompts between echoed lines, so the marker (a line
  // of its own, printed before the interpreter runs) is the reliable capture start.
  const run = `echo __WEBPC_OUT_${id}__ ; ${lang === 'python' ? 'python3' : 'node'} ${file}`;
  return `cat > ${file} <<'${marker}'\n${code}\n${marker}\n${run}${sentinel}`;
}

// The guest's PS1 is `webpc:<dir># `; the serial output tail ends there when the
// shell is idle. Anchored at the end (the boot check uses the same pattern).
export function isAtShellPrompt(tail) {
  return /webpc:[^\r\n]*# [\r\n\s]*$/.test(tail);
}

// The sentinel line, anchored: `__WEBPC_END_<id>_<0-255>__` alone on a line. Similar
// text (other ids, codes above 255, un-anchored, unterminated) never matches.
export function findSentinel(buffer, id) {
  const re = new RegExp(`(^|\\n)__WEBPC_END_${id}_(\\d{1,3})__(?=\\r?\\n|$)`, 'g');
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

// Where the command's own output begins, in normalized text (ANSI stripped,
// CRs→LFs): the guest echoes each sent CR as a bare \r byte (plus a bare-\r blank
// line), so line-anchored cuts must run on the normalized text. Heredoc runs
// (python/node) start after the LAST line consisting only of the __WEBPC_OUT_<id>__
// marker the run line prints (before the interpreter runs, so the cut never eats
// command output). For sh the echo is the sent command — normalized, its CRs are
// LFs — cut right after it.
export function cutStart(text, id, sentCommand, lang) {
  if (lang === 'python' || lang === 'node') {
    const marker = `__WEBPC_OUT_${id}__`;
    const start = findOwnLine(text, marker, true);
    if (start >= 0) return start + marker.length + 1; // +1 skips the \n of the marker line
  }
  const sent = toSentBytes(sentCommand).replace(/\r/g, '\n'); // the echo, normalized
  return text.startsWith(sent) ? sent.length : 0;
}

// output = everything before the sentinel line, from cutStart on. The text is
// normalized first (ANSI stripped, CRs→LFs) because the guest's CR echo is bare \r.
// One leading newline (CR-echo artifact) and one trailing newline (the sentinel's
// own leading newline) are stripped; bounded to 64 KB (the tail is kept).
export function parseExecResult(buffer, id, sentCommand, lang) {
  const found = findSentinel(buffer, id);
  if (!found) return null;
  const pre = stripAnsi(buffer.slice(0, found.index)).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  let output = pre.slice(cutStart(pre, id, sentCommand, lang));
  if (output.startsWith('\n')) output = output.slice(1);
  if (output.endsWith('\n')) output = output.slice(0, -1);
  let truncated = false;
  if (output.length > MAX_OUTPUT) { output = output.slice(-MAX_OUTPUT); truncated = true; }
  return { exitCode: found.exitCode, output, truncated };
}

// The end of the echoed sent command in normalized text (sh timeout path): the sent
// characters appear in order, but the tty interleaves wrap-around artifacts (a line
// at the console width is re-displayed as fragments, stray characters) and a bare-\r
// CR echo plus a blank-line artifact per sent CR. Match the sent characters as a
// subsequence, then advance past the blank lines that follow — the real output
// starts there.
function shEchoEnd(text, sentCommand) {
  const sent = toSentBytes(sentCommand).replace(/\r/g, '').replace(/\n/g, '');
  let i = 0, lastPos = -1;
  for (let j = 0; j < text.length && i < sent.length; j++) if (text[j] === sent[i]) { lastPos = j; i++; }
  if (i < sent.length) return 0; // Incomplete echo: do not cut.
  const pair = text.indexOf('\n\n', lastPos);
  if (pair !== -1) return pair + 2;
  const nl = text.indexOf('\n', lastPos);
  return nl === -1 ? text.length : nl + 1;
}

// Partial output for the timeout path: the same normalization and cut as a normal
// result — heredoc runs start after the last OUT marker line (or are empty if the
// marker never arrived); sh starts after the echoed command, which can wrap at the
// console width. Then drop the trailing shell prompt (printed after the Ctrl+C) and
// the surrounding blank lines.
export function parseExecPartial(buffer, id, sentCommand, lang) {
  const text = stripAnsi(buffer).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  let output;
  if (lang === 'python' || lang === 'node') {
    const marker = `__WEBPC_OUT_${id}__`;
    const start = findOwnLine(text, marker, true);
    output = start >= 0 ? text.slice(start + marker.length + 1) : '';
  } else {
    output = text.slice(shEchoEnd(text, sentCommand));
  }
  const prompt = output.match(/\n?webpc:[^\n]*# [^\n]*$/);
  if (prompt) output = output.slice(0, output.length - prompt[0].length);
  return output.trim();
}
