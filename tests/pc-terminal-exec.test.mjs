import test from 'node:test';
import assert from 'node:assert/strict';
import { validateExecRequest, buildExecCommand, findSentinel, parseExecResult, parseExecPartial, stripAnsi, isAtShellPrompt, toSentBytes, findOwnLine, cutStart, randomNonce, base64Encode, visibleCode, handleExecChannelMessage, MAX_OUTPUT, MAX_TIMEOUT_MS, DEFAULT_TIMEOUT_MS } from '../src/scripts/pc/apps/terminal-exec.mjs';

const req = { type: 'exec-request', id: 'r1', from: 'AI Agent', lang: 'sh', code: 'echo hi', timeoutMs: DEFAULT_TIMEOUT_MS };
const nonce = '0123456789abcdef';

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

test('randomNonce: 16 lowercase hex chars, drawn from the injected source', () => {
  assert.match(randomNonce(), /^[0-9a-f]{16}$/);
  assert.notEqual(randomNonce(), randomNonce(), 'consecutive nonces differ');
  assert.equal(randomNonce({ getRandomValues: view => (view.fill(9), view) }), '0909090909090909', 'the bytes map to hex in order');
});

test('base64Encode matches the standard alphabet, padding and UTF-8 bytes', () => {
  assert.equal(base64Encode(''), '');
  assert.equal(base64Encode('f'), 'Zg==');
  assert.equal(base64Encode('fo'), 'Zm8=');
  assert.equal(base64Encode('foo'), 'Zm9v');
  assert.equal(base64Encode('foo bar'), 'Zm9vIGJhcg==');
  // Non-ASCII: the UTF-8 bytes, not the UTF-16 code units.
  assert.equal(base64Encode('é'), Buffer.from('é', 'utf8').toString('base64'));
  assert.equal(base64Encode('héllo →'), Buffer.from('héllo →', 'utf8').toString('base64'));
  const roundTrip = 'a\nb\tc\r\x01\x1f end';
  assert.equal(Buffer.from(base64Encode(roundTrip), 'base64').toString('utf8'), roundTrip);
});

// T3: the code is never typed — it goes out as base64 printf chunks into a .b64 file and
// runs from a file. The chunks must decode back to the exact code (the code shown is the
// code that runs), every chunk is single-quoted and base64-only (nothing reaches the tty
// as a control or metacharacter), and every language prints the OUT marker before running.
test('command building: base64 chunks decode to the exact code, all languages run from a file', () => {
  for (const [lang, ext, interpreter] of [['sh', 'sh', 'bash'], ['python', 'py', 'python3'], ['node', 'js', 'node']]) {
    const code = lang === 'python' ? 'print(2+2)' : lang === 'node' ? 'console.log(1)' : 'echo hello';
    const command = buildExecCommand('r3', lang, code, nonce);
    const lines = command.split('\n');
    assert.equal(lines[0], `: > /tmp/webpc-r3.b64`, 'the .b64 file is truncated first');
    const chunks = [];
    for (const line of lines.slice(1, -2)) {
      const match = line.match(/^printf %s '([A-Za-z0-9+/=]+)' >> \/tmp\/webpc-r3\.b64$/);
      assert.ok(match, `every middle line is a quoted base64 chunk, got: ${line.slice(0, 40)}`);
      assert.ok(match[1].length <= 2000, 'chunks stay within one printf line');
      chunks.push(match[1]);
    }
    assert.equal(Buffer.from(chunks.join(''), 'base64').toString('utf8'), code, 'the sent chunks decode to exactly the code');
    assert.equal(lines[lines.length - 2], `base64 -d /tmp/webpc-r3.b64 > /tmp/webpc-r3.${ext}`);
    const run = lines[lines.length - 1];
    assert.ok(run.startsWith(`echo __WEBPC_OUT_r3_${nonce}__ ; ${interpreter} /tmp/webpc-r3.${ext}; `), 'the run line prints the OUT marker, then runs the file');
    assert.ok(run.endsWith(`printf '\\n__WEBPC_END_%s_%s_%d__\\n' r3 ${nonce} $?`), 'the sentinel carries the nonce');
    assert.ok(!command.includes(code) || code.length < 4, 'raw code text never reaches the serial line');
  }
});

test('command building: a per-run nonce is required (the id alone can be faked)', () => {
  for (const bad of [undefined, '', 'SHORT', '0123456789abcdefg!', 'ABCDEF0123456789']) {
    assert.throws(() => buildExecCommand('r3', 'sh', 'echo hi', bad), /nonce/, `rejects ${JSON.stringify(bad)}`);
  }
});

// T4: sh code with a trailing newline or a trailing "# comment" runs from a file, so
// neither can break the run — the file content is exactly the code, sentinel intact.
test('command building: trailing newline and trailing comment sh code survive as file content', () => {
  for (const code of ['echo hi\n', 'echo hi # trailing comment', 'echo a\n# only a comment\n', '']) {
    const command = buildExecCommand('r4', 'sh', code, nonce);
    const chunks = [...command.matchAll(/printf %s '([A-Za-z0-9+/=]+)' >>/g)].map(m => m[1]);
    assert.equal(Buffer.from(chunks.join(''), 'base64').toString('utf8'), code, `exact code preserved: ${JSON.stringify(code)}`);
    // No line of the sent command starts with ';' (the old append-after-last-line bug)
    // and no sent line is the code itself.
    for (const line of command.split('\n')) assert.ok(!line.startsWith(';'), `no bare-semicolon line: ${line.slice(0, 30)}`);
  }
});

test('sentinel parsing: anchored line with nonce and exit code 0-255; similar text is ignored', () => {
  const buffer = 'echo hi\r\n__WEBPC_END_other_0123456789abcdef_0__\r\n__WEBPC_END_r1_ffffffffffffffff_9__\r\nx__WEBPC_END_r1_0123456789abcdef_999__\r\n__WEBPC_END_r1_0123456789abcdef_2\r\n__WEBPC_END_r1_0123456789abcdef_3__\r\nwebpc:~# ';
  const found = findSentinel(buffer, 'r1', nonce);
  assert.equal(found.exitCode, 3, 'first valid line wins: other id, other nonce, >255, un-anchored and unterminated lines do not match');
  assert.equal(buffer.slice(found.index, found.index + found.length), '__WEBPC_END_r1_0123456789abcdef_3__');
  assert.equal(findSentinel('prefix\r\n__WEBPC_END_r9_0123456789abcdef_0__', 'r9', nonce).exitCode, 0, 'a sentinel at the buffer end (still streaming) matches');
  assert.equal(findSentinel('no sentinel here', 'r1', nonce), null);
});

// T6: code that runs can print a sentinel-looking line, but not with the per-run nonce it
// cannot know: a wrong-nonce (or old-format) end marker does not close the capture.
test('a run cannot fake its own sentinel: wrong or missing nonce never matches', () => {
  const code = "printf '__WEBPC_END_r6_0__\\n__WEBPC_END_r6_fedcba9876543210_0__\\nFAKE_END\\n'";
  const command = buildExecCommand('r6', 'sh', code, nonce);
  const buffer = toSentBytes(command) + '\r\n__WEBPC_OUT_r6_' + nonce + '__\r\n' + 'FAKE_END\r\n' + '\r\n' + `__WEBPC_END_r6_${nonce}_0__` + '\r\n';
  const result = parseExecResult(buffer, 'r6', 'sh', nonce);
  assert.equal(result.exitCode, 0);
  assert.equal(result.output, 'FAKE_END\n', 'the real (nonced) sentinel ends the capture; the fakes are just output');
  // And with no real sentinel at all, nothing is a result.
  assert.equal(parseExecResult(buffer.replace(`__WEBPC_END_r6_${nonce}_0__`, 'gone'), 'r6', 'sh', nonce), null);
});

test('ANSI stripping removes escapes, keeps visible text and line breaks', () => {
  assert.equal(stripAnsi('\x1b[31mred\x1b[0m and \x1b]0;title\x07osc \x1b[2J\x1b[A'), 'red and osc ');
  assert.equal(stripAnsi('a\x00\x07b'), 'ab');
  assert.equal(stripAnsi('keep\t\n\r'), 'keep\t\n\r');
});

test('the 64 KB bound keeps the tail and sets truncated', () => {
  const command = buildExecCommand('r7', 'sh', 'cat big.txt', nonce);
  const buffer = toSentBytes(command) + '\r\n__WEBPC_OUT_r7_' + nonce + '__\r\n' + 'A'.repeat(70000) + 'Z'.repeat(70000) + '\r\n' + `__WEBPC_END_r7_${nonce}_0__` + '\r\n';
  const result = parseExecResult(buffer, 'r7', 'sh', nonce);
  assert.equal(result.exitCode, 0);
  assert.equal(result.output.length, MAX_OUTPUT);
  assert.equal(result.truncated, true);
  assert.ok(!result.output.includes('A') && result.output.startsWith('Z') && result.output.endsWith('Z'), 'the tail is kept, the head dropped');
});

test('parseExecResult strips the echo and keeps only the command output', () => {
  const code = 'print(2+2)\nprint("second")';
  const command = buildExecCommand('r8', 'python', code, nonce);
  // Serial shape: echoed sent bytes (the long base64 lines wrap and echo as bare \r),
  // the run line's own __WEBPC_OUT_ marker line (the echo contains the marker as a
  // substring but not as a line, so it is not the cut point), the command's output,
  // the sentinel printf's own leading newline, the sentinel line.
  const buffer = toSentBytes(command) + '\r\n__WEBPC_OUT_r8_' + nonce + '__\r\n' + '4\r\nsecond\r\n' + '\r\n' + `__WEBPC_END_r8_${nonce}_0__` + '\r\n';
  const result = parseExecResult(buffer, 'r8', 'python', nonce);
  assert.equal(result.exitCode, 0);
  assert.equal(result.output, '4\nsecond\n');
  assert.ok(!result.output.includes('print('), 'the code content is not in the result (it went to the file, not the tty)');
  assert.ok(!result.output.includes('__WEBPC_OUT_r8_'), 'the marker line is not in the result');
  assert.ok(!result.output.includes('printf %s'), 'the base64 chunk echoes are not in the result');
  assert.equal(parseExecResult('no sentinel', 'r8', 'sh', nonce), null);
});

// T5: the OUT marker line now cuts for every language, including sh — the sh echo (wrapped
// at the console width, with artifacts) is dropped by the marker, not byte-exact match.
test('sh output is cut at the OUT marker line, not by the echoed command', () => {
  const command = buildExecCommand('r9', 'sh', 'echo out', nonce);
  // The echo wraps at 80 columns with a re-displayed fragment, exactly like the
  // production capture; the marker line still starts the capture.
  const buffer = toSentBytes(command).slice(0, 60) + '\n?' + toSentBytes(command).slice(60) + '\r\n' + `__WEBPC_OUT_r9_${nonce}__\r\n` + 'out\r\n' + '\r\n' + `__WEBPC_END_r9_${nonce}_0__` + '\r\n';
  const result = parseExecResult(buffer, 'r9', 'sh', nonce);
  assert.equal(result.exitCode, 0);
  assert.equal(result.output, 'out\n');
});

test('an OUT marker printed by the code does not move the cut: the last marker line wins', () => {
  const py = buildExecCommand('rA', 'python', 'print("x")', nonce);
  const markerLine = `__WEBPC_OUT_rA_${nonce}__`;
  // The run line's echo contains the marker as a substring; two standalone marker
  // lines (the run line's, then one the code prints): the cut is after the last.
  const pyText = toSentBytes(py).replace(/\r/g, '\n') + '\n' + markerLine + '\n' + '1\n' + markerLine + '\n' + '2\n';
  assert.equal(pyText.slice(cutStart(pyText, 'rA', nonce)), '2\n');
  // With no marker line at all, the cut is the start.
  assert.equal(cutStart('nothing here', 'rA', nonce), 0);
});

test('findOwnLine matches the line only as a full standalone line', () => {
  const line = '__WEBPC_OUT_ab__';
  assert.equal(findOwnLine(`pre\r\n${line}\r\npost`, line), 'pre\r\n'.length, 'a standalone line matches');
  assert.equal(findOwnLine(`echo ${line} ; python3 /tmp/x.py`, line), -1, 'the run-line echo (marker as substring) does not match');
  assert.equal(findOwnLine(`${line}extra\n`, line), -1, 'a longer line starting with it does not match');
  assert.equal(findOwnLine('no match here', line), -1);
  assert.equal(findOwnLine(`x\n${line}\ny\n${line}\nz\n`, line, true), `x\n${line}\ny\n`.length, 'last mode finds the last standalone line');
});

// T3 prompt display: C0 controls, DEL and bidi/zero-width characters are visible;
// newlines stay newlines; visible text is untouched.
test('visibleCode renders invisible characters as escapes and leaves the rest alone', () => {
  assert.equal(visibleCode('a\rb\nc\td'), 'a\\x0db\nc\\x09d', 'CR and TAB render as escapes; the newline stays a newline');
  assert.equal(visibleCode('\x00\x07\x7f'), '\\x00\\x07\\x7f');
  assert.equal(visibleCode('ok\u202E\u200B\uFEFFend'), 'ok<U+202E><U+200B><U+FEFF>end');
  assert.equal(visibleCode('plain code\nwith a tab'), 'plain code\nwith a tab');
  assert.equal(visibleCode('a\u2066b'), 'a<U+2066>b', 'isolated run controls are visible too');
});

// T1: replies and foreign messages never get an answer — the two-Terminal bounce loop.
test('channel triage: only exec-request is handled; replies and foreign traffic are ignored', () => {
  const promptSlot = { phase: 'prompt', req: { id: 'r1' } };
  assert.deepEqual(handleExecChannelMessage({ type: 'exec-request', id: 'r1' }, null), { action: 'request' });
  for (const foreign of [
    { type: 'exec-error', id: 'r1', reason: 'invalid' },
    { type: 'exec-error', id: 'r1', reason: 'busy' },
    { type: 'exec-result', id: 'r1', exitCode: 0, output: '' },
    { type: 'exec-pending', id: 'r1' },
    { type: 'pc:theme', theme: 'dark' },
    { type: 'something-else' },
    null, undefined, 'a string', 42,
  ]) assert.deepEqual(handleExecChannelMessage(foreign, promptSlot), { action: 'ignore' }, `must ignore: ${JSON.stringify(foreign)}`);
  assert.deepEqual(handleExecChannelMessage({ type: 'exec-request' }, promptSlot), { action: 'request' }, 'a request is a request even while prompting');
});

// T2: another Terminal's exec-started/exec-cancel for the id this one is prompting for
// withdraws the prompt; other ids, running slots and missing slots are untouched.
test('channel triage: exec-started/exec-cancel withdraw only a matching pending prompt', () => {
  const prompt = { phase: 'prompt', req: { id: 'r1' } };
  for (const type of ['exec-started', 'exec-cancel']) {
    assert.deepEqual(handleExecChannelMessage({ type, id: 'r1' }, prompt), { action: 'withdraw' });
    assert.deepEqual(handleExecChannelMessage({ type, id: 'other' }, prompt), { action: 'ignore' }, `${type}: a different id does not withdraw`);
    assert.deepEqual(handleExecChannelMessage({ type, id: 'r1' }, { phase: 'run', req: { id: 'r1' } }), { action: 'ignore' }, `${type}: a running command is left to its own timeout`);
    assert.deepEqual(handleExecChannelMessage({ type, id: 'r1' }, null), { action: 'ignore' }, `${type}: nothing pending, nothing to withdraw`);
  }
});

test('toSentBytes submits every line on CR, including the final line', () => {
  assert.equal(toSentBytes('echo hi'), 'echo hi\r');
  assert.equal(toSentBytes('a\nb\nc'), 'a\rb\rc\r');
});

// Timeout partials: the cut is the marker line for every language (or empty if it never
// arrived), then the trailing shell prompt is dropped.
test('timeout partial: sh keeps only output after the marker, drops wrap artifacts and the prompt', () => {
  const command = buildExecCommand('sh-slow', 'sh', 'sleep 100; echo NEVER_DONE', nonce);
  // Wrapped echo fragments and a stray re-displayed character, then the marker, then the
  // prompt after Ctrl+C: nothing but the (empty) real output survives.
  const buffer = `junk ?\n${toSentBytes(command).replace(/\r/g, '\n')}\n__WEBPC_OUT_sh-slow_${nonce}__\n\nwebpc:~# `;
  assert.equal(parseExecPartial(buffer, 'sh-slow', 'sh', nonce), '');
});

test('timeout partial: keeps real output after the marker, drops the trailing prompt (all languages)', () => {
  const sh = buildExecCommand('sh-part', 'sh', 'echo A; sleep 100', nonce);
  assert.equal(parseExecPartial(`${sh}\n__WEBPC_OUT_sh-part_${nonce}__\nA\n\nwebpc:~# `, 'sh-part', 'sh', nonce), 'A');
  const py = buildExecCommand('py-slow', 'python', 'import time; time.sleep(100)', nonce);
  assert.equal(parseExecPartial(`junk line\r\n__WEBPC_OUT_py-slow_${nonce}__\r\nPARTIAL\r\nwebpc:~# `, 'py-slow', 'python', nonce), 'PARTIAL');
  assert.equal(parseExecPartial('cat > /tmp/webpc-py-slow.b64\r\nwebpc:~# ', 'py-slow', 'python', nonce), '', 'no marker: nothing but the empty string');
});

test('the idle check is anchored at the end of the output tail', () => {
  assert.equal(isAtShellPrompt('boot done\r\nwebpc:~# '), true);
  assert.equal(isAtShellPrompt('webpc:/root# '), true);
  assert.equal(isAtShellPrompt('building\r\nstill compiling...'), false);
  assert.equal(isAtShellPrompt(''), false);
});
