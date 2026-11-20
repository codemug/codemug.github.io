import test from 'node:test';
import assert from 'node:assert/strict';
import { validateExecRequest, pickMarker, buildExecCommand, findSentinel, parseExecResult, parseExecPartial, stripAnsi, isAtShellPrompt, toSentBytes, findOwnLine, cutStart, MAX_OUTPUT, MAX_TIMEOUT_MS, DEFAULT_TIMEOUT_MS } from '../src/scripts/pc/apps/terminal-exec.mjs';

const req = { type: 'exec-request', id: 'r1', from: 'AI Agent', lang: 'sh', code: 'echo hi', timeoutMs: DEFAULT_TIMEOUT_MS };

test('request validation: shape, caps, and the default timeout', () => {
  assert.deepEqual(validateExecRequest({ ...req, timeoutMs: undefined }), { ok: true, id: 'r1', from: 'AI Agent', lang: 'sh', code: 'echo hi', timeoutMs: DEFAULT_TIMEOUT_MS });
  assert.equal(validateExecRequest({ ...req }).ok, true);
  assert.equal(validateExecRequest({ ...req, timeoutMs: MAX_TIMEOUT_MS }).ok, true, 'the cap itself is allowed');
  for (const bad of [
    null, {}, { ...req, id: 'bad id!' }, { ...req, id: 'x'.repeat(65) }, { ...req, id: 'a.b' }, { ...req, from: '' }, { ...req, from: 7 },
    { ...req, lang: 'ruby' }, { ...req, code: 42 }, { ...req, code: 'x'.repeat(MAX_OUTPUT + 1) },
    { ...req, timeoutMs: MAX_TIMEOUT_MS + 1 }, { ...req, timeoutMs: 'fast' }, { ...req, timeoutMs: -5 }, { ...req, timeoutMs: NaN },
  ]) assert.equal(validateExecRequest(bad).ok, false, JSON.stringify(bad));
});

test('heredoc marker does not occur in the code and regenerates on collision', () => {
  const code = 'print("WEBPC_EOF_aaaaaaaa")\n';
  let calls = 0;
  const marker = pickMarker(code, () => (calls += 1, calls <= 8 ? 'a' : 'b'));
  assert.equal(marker, 'WEBPC_EOF_bbbbbbbb', 'first colliding candidate is regenerated');
  assert.ok(!code.includes(marker));
  const plain = pickMarker('nothing special here');
  assert.match(plain, /^WEBPC_EOF_[a-z]{8}$/);
});

test('command building: sh as given, python/node through a heredoc, sentinel always appended', () => {
  assert.equal(buildExecCommand('r1', 'sh', 'echo hello'), "echo hello; printf '\\n__WEBPC_END_%s_%d__\\n' r1 $?");
  assert.equal(buildExecCommand('r2', 'sh', ''), "printf '\\n__WEBPC_END_%s_%d__\\n' r2 $?", 'empty sh code still sends the sentinel');
  const py = buildExecCommand('r3', 'python', 'print(2+2)');
  const pyLines = py.split('\n');
  const marker = pyLines[0].match(/<<'([^']+)'$/)?.[1];
  assert.match(marker ?? '', /^WEBPC_EOF_[a-z]{8}$/);
  assert.deepEqual(pyLines, [`cat > /tmp/webpc-r3.py <<'${marker}'`, 'print(2+2)', marker, `echo __WEBPC_OUT_r3__ ; python3 /tmp/webpc-r3.py; printf '\\n__WEBPC_END_%s_%d__\\n' r3 $?`]);
  const js = buildExecCommand('r4', 'node', 'console.log(1)');
  assert.match(js, /^cat > \/tmp\/webpc-r4\.js <<'WEBPC_EOF_[a-z]{8}'\nconsole\.log\(1\)\nWEBPC_EOF_[a-z]{8}\necho __WEBPC_OUT_r4__ ; node \/tmp\/webpc-r4\.js; printf/);
});

test('sentinel parsing: anchored line with exit code 0-255; similar text is ignored', () => {
  const buffer = 'echo hi\r\n__WEBPC_END_other_0__\r\n__WEBPC_END_r1_999__\r\nx__WEBPC_END_r1_1__\r\n__WEBPC_END_r1_2\r\n__WEBPC_END_r1_3__\r\nwebpc:~# ';
  const found = findSentinel(buffer, 'r1');
  assert.equal(found.exitCode, 3, 'first valid line wins: other id, >255, un-anchored and unterminated lines do not match');
  assert.equal(buffer.slice(found.index, found.index + found.length), '__WEBPC_END_r1_3__');
  assert.equal(findSentinel('prefix\r\n__WEBPC_END_r9_0__', 'r9').exitCode, 0, 'a sentinel at the buffer end (still streaming) matches');
  assert.equal(findSentinel('no sentinel here', 'r1'), null);
});

test('ANSI stripping removes escapes, keeps visible text and line breaks', () => {
  assert.equal(stripAnsi('\x1b[31mred\x1b[0m and \x1b]0;title\x07osc \x1b[2J\x1b[A'), 'red and osc ');
  assert.equal(stripAnsi('a\x00\x07b'), 'ab');
  assert.equal(stripAnsi('keep\t\n\r'), 'keep\t\n\r');
});

test('the 64 KB bound keeps the tail and sets truncated', () => {
  const command = buildExecCommand('r7', 'sh', 'cat big.txt');
  const buffer = toSentBytes(command) + 'A'.repeat(70000) + 'Z'.repeat(70000) + '\r\n' + '__WEBPC_END_r7_0__' + '\r\n';
  const result = parseExecResult(buffer, 'r7', command, 'sh');
  assert.equal(result.exitCode, 0);
  assert.equal(result.output.length, MAX_OUTPUT);
  assert.equal(result.truncated, true);
  assert.ok(!result.output.includes('A') && result.output.startsWith('Z') && result.output.endsWith('Z'), 'the tail is kept, the head dropped');
});

test('parseExecResult strips the echoed command and the heredoc body', () => {
  const code = 'print(2+2)\nprint("second")';
  const command = buildExecCommand('r8', 'python', code);
  // Serial shape: echoed sent bytes (incl. the final CR), the run line's own
  // __WEBPC_OUT_ marker line (the echo of the run line contains the marker as a
  // substring but not as a line, so it is not the cut point), the command's output
  // (ONLCR), then the sentinel printf's own leading newline, the sentinel line.
  const buffer = toSentBytes(command) + '\r\n__WEBPC_OUT_r8__\r\n' + '4\r\nsecond\r\n' + '\r\n__WEBPC_END_r8_0__' + '\r\n';
  const result = parseExecResult(buffer, 'r8', command, 'python');
  assert.equal(result.exitCode, 0);
  assert.equal(result.output, '4\nsecond\n');
  assert.ok(!result.output.includes('print('), 'the echoed heredoc body is not in the result');
  assert.ok(!result.output.includes('__WEBPC_OUT_r8__'), 'the marker line is not in the result');
  assert.equal(parseExecResult('no sentinel', 'r8', command, 'python'), null);
});

test('the OUT marker line is only trusted for the heredoc languages', () => {
  // sh code that prints the marker line as its own output: the output is kept whole.
  const sh = buildExecCommand('r9', 'sh', "printf 'x\\n__WEBPC_OUT_r9__\\n'");
  const shBuffer = toSentBytes(sh) + '\r\n' + 'x\r\n__WEBPC_OUT_r9__\r\n' + '\r\n__WEBPC_END_r9_0__' + '\r\n';
  assert.equal(parseExecResult(shBuffer, 'r9', sh, 'sh').output, 'x\n__WEBPC_OUT_r9__\n', 'sh output containing the marker line is not cut');
  // The same text for a python run is cut at the (first, real) marker line.
  const py = buildExecCommand('r9', 'python', 'print("x")');
  const pyBuffer = toSentBytes(py) + '\r\n__WEBPC_OUT_r9__\r\n' + 'x\r\n' + '\r\n__WEBPC_END_r9_0__' + '\r\n';
  assert.equal(parseExecResult(pyBuffer, 'r9', py, 'python').output, 'x\n');
});

test('findOwnLine matches the line only as a full standalone line', () => {
  const line = '__WEBPC_OUT_ab__';
  assert.equal(findOwnLine(`pre\r\n${line}\r\npost`, line), 'pre\r\n'.length, 'a standalone line matches');
  assert.equal(findOwnLine(`echo ${line} ; python3 /tmp/x.py`, line), -1, 'the run-line echo (marker as substring) does not match');
  assert.equal(findOwnLine(`${line}extra\n`, line), -1, 'a longer line starting with it does not match');
  assert.equal(findOwnLine('no match here', line), -1);
  assert.equal(findOwnLine(`x\n${line}\ny\n${line}\nz\n`, line, true), `x\n${line}\ny\n`.length, 'last mode finds the last standalone line');
});

test('cutStart works on normalized text: byte-exact echo for sh, last marker line for heredoc langs', () => {
  const sh = buildExecCommand('rA', 'sh', 'echo out');
  const shText = sh + '\n' + 'OUT\n';
  assert.equal(cutStart(shText, 'rA', sh, 'sh'), sh.length + 1);
  const py = buildExecCommand('rA', 'python', 'print(1)');
  const markerLine = '__WEBPC_OUT_rA__';
  // The run line's echo contains the marker as a substring; two standalone marker
  // lines (the run line's, then one the code prints): the cut is after the last.
  const pyText = py + '\n' + markerLine + '\n' + '1\n' + markerLine + '\n' + '2\n';
  assert.equal(pyText.slice(cutStart(pyText, 'rA', py, 'python')), '2\n');
});

// Fix round 1: the exact production echo shape from the lead's preview run. The
// guest echoes each sent CR as a bare \r (plus a bare-\r blank-line artifact), so in
// the raw buffer the marker line is preceded by \r, not \n — the cut must run on
// normalized text and take the last standalone marker line.
test('python: production capture shape (bare CR echo) is cut at the last marker line', () => {
  const id = 'py-add';
  const command = buildExecCommand(id, 'python', 'print(2+2)');
  const raw = `cat > /tmp/webpc-${id}.py <<'WEBPC_EOF_dqhoyfqe'\r` +
    `\r> print(2+2)\r` +
    `\r> WEBPC_EOF_dqhoyfqe\r` +
    `\rwebpc:~# echo __WEBPC_OUT_${id}__ ; python3 /tmp/webpc-${id}.py; printf '\\n__WEBPC_END_%s_%d__\\n' ${id} $?\r` +
    `\r__WEBPC_OUT_${id}__\r\n` +
    `4\r\n\r\n` +
    `__WEBPC_END_${id}_0__\r\n`;
  const result = parseExecResult(raw, id, command, 'python');
  assert.equal(result.exitCode, 0);
  assert.equal(result.output, '4\n', 'everything before the marker line is stripped, including the echoed command');
  assert.ok(!result.output.includes('print('));
  assert.ok(!result.output.includes('WEBPC_EOF_'));
});

test('sh: production capture shape (bare CR echo) is cut after the byte-exact echo', () => {
  const id = 'sh-hello';
  const command = buildExecCommand(id, 'sh', 'echo hello');
  // Sent = the single-line command plus the final CR; the CRs echo as bare \r; the
  // command output and the sentinel are \r\n (ONLCR).
  const raw = command + '\r\r' + 'hello\r\n' + '\r\n' + `__WEBPC_END_${id}_0__` + '\r\n';
  const result = parseExecResult(raw, id, command, 'sh');
  assert.equal(result.exitCode, 0);
  assert.equal(result.output, 'hello\n');
});

// Fix round 2: the exact partial buffer captured in the lead's production run
// (sh timeout case): the echo line reaches the console width and wraps (a stray `?`
// is re-displayed on its own line), the CR echo and blank-line artifacts follow, and
// the buffer ends at the shell prompt printed after the Ctrl+C. The partial output
// must drop all of that and be empty.
test('timeout partial: the captured production sh buffer yields no real output', () => {
  const id = 'sh-slow';
  const command = buildExecCommand(id, 'sh', 'sleep 100; echo NEVER_DONE');
  const buffer = `sleep 100; echo NEVER_DONE; printf '\\n__WEBPC_END_%s_%d__\\n' ${id} $? \n?\n\n\nwebpc:~# `;
  assert.equal(parseExecPartial(buffer, id, command, 'sh'), '', 'wrapped echo, re-displayed fragment, artifacts and prompt are all dropped');
});

test('timeout partial: keeps real output, drops the echo, blank-line artifacts and the trailing prompt', () => {
  const id = 'sh-part';
  const command = buildExecCommand(id, 'sh', 'echo A; sleep 100');
  const buffer = command + '\n\n' + 'A\n' + '\nwebpc:~# ';
  assert.equal(parseExecPartial(buffer, id, command, 'sh'), 'A');
});

test('timeout partial: python keeps only output after the marker, or is empty if the marker never arrived', () => {
  const id = 'py-slow';
  const command = buildExecCommand(id, 'python', 'import time; time.sleep(100)');
  const withMarker = `junk line\r\n__WEBPC_OUT_${id}__\r\nPARTIAL\r\nwebpc:~# `;
  assert.equal(parseExecPartial(withMarker, id, command, 'python'), 'PARTIAL');
  assert.equal(parseExecPartial('cat > /tmp/webpc-py-slow.py <<\'M\'\r\nM\r\nwebpc:~# ', id, command, 'python'), '', 'no marker: nothing but the empty string');
});

test('toSentBytes submits every line on CR, including the final line', () => {
  assert.equal(toSentBytes('echo hi'), 'echo hi\r');
  assert.equal(toSentBytes('a\nb\nc'), 'a\rb\rc\r');
});

test('the idle check is anchored at the end of the output tail', () => {
  assert.equal(isAtShellPrompt('boot done\r\nwebpc:~# '), true);
  assert.equal(isAtShellPrompt('webpc:/root# '), true);
  assert.equal(isAtShellPrompt('building\r\nstill compiling...'), false);
  assert.equal(isAtShellPrompt(''), false);
});
