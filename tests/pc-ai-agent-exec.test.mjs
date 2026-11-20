// Unit tests for AI-4 review fix 11: the exec-bridge client (exec-client.js) — request shape,
// the 20 KB output cap, the not-running/busy grace (settles only if the terminal page never
// acks with exec-pending), immediate settle for other errors, cancelAll, and the wall timer.
// No real BroadcastChannel: a fake channel with the same two members (postMessage, addEventListener).
// Run: node --test tests/pc-ai-agent-exec.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createExecClient, MAX_EXEC_OUTPUT_CHARS } from '../src/apps/ai-agent/exec-client.js';

class FakeChannel {
  posts = [];
  listener = null;
  addEventListener(type, cb) { assert.equal(type, 'message'); this.listener = cb; }
  postMessage(msg) { this.posts.push(msg); }
  emit(data) { this.listener?.({ data }); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('run posts an exec-request and settles with the terminal reply', async () => {
  const ch = new FakeChannel();
  const exec = createExecClient(ch);
  const p = exec.run('python', 'print(1)', 5000);
  assert.match(ch.posts[0].id, /^agent-\d+-\d+$/, 'agent-prefixed id');
  assert.deepEqual(ch.posts[0], { type: 'exec-request', id: ch.posts[0].id, from: 'AI Agent', lang: 'python', code: 'print(1)', timeoutMs: 5000 });
  ch.emit({ type: 'exec-result', id: ch.posts[0].id, exitCode: 0, output: '1' });
  assert.deepEqual(await p, { type: 'exec-result', exitCode: 0, output: '1', truncated: false });
});

test('exec-result output is capped at 20 000 chars and flagged truncated', async () => {
  const ch = new FakeChannel();
  const exec = createExecClient(ch);
  const p = exec.run('node', 'big', 5000);
  ch.emit({ type: 'exec-result', id: ch.posts[0].id, exitCode: 0, output: 'x'.repeat(MAX_EXEC_OUTPUT_CHARS + 5000) });
  const out = await p;
  assert.equal(out.output.length, MAX_EXEC_OUTPUT_CHARS, 'the cap is applied to the stored reply');
  assert.equal(out.truncated, true);
  const p2 = exec.run('node', 'small', 5000);
  ch.emit({ type: 'exec-result', id: ch.posts[1].id, exitCode: 1, output: 'small' });
  assert.deepEqual(await p2, { type: 'exec-result', exitCode: 1, output: 'small', truncated: false }, 'a small output is untouched');
});

test('not-running and busy wait the grace and settle only if no exec-pending arrives', async () => {
  for (const reason of ['not-running', 'busy']) {
    const ch = new FakeChannel();
    const exec = createExecClient(ch, { graceMs: 80 });
    const p = exec.run('sh', 'ls', 5000);
    const id = ch.posts[0].id;
    let done = false; let result = null;
    p.then((r) => { result = r; done = true; });
    ch.emit({ type: 'exec-error', id, reason });
    await sleep(30);
    assert.equal(done, false, `${reason}: still open during the grace`);
    await sleep(100);
    assert.equal(done, true, `${reason}: settled after the grace`);
    assert.deepEqual(result, { type: 'exec-error', id, reason });
  }
});

test('an exec-pending within the grace keeps the run open until the real reply', async () => {
  const ch = new FakeChannel();
  const exec = createExecClient(ch, { graceMs: 200 });
  const p = exec.run('sh', 'ls', 5000);
  const id = ch.posts[0].id;
  let done = false;
  p.then(() => { done = true; });
  ch.emit({ type: 'exec-error', id, reason: 'busy' });
  await sleep(50);
  ch.emit({ type: 'exec-pending', id });
  await sleep(220); // past the grace: it must NOT have settled with the busy error
  assert.equal(done, false, 'the pending ack cancelled the grace; still waiting for the run');
  ch.emit({ type: 'exec-result', id, exitCode: 0, output: 'ok' });
  assert.deepEqual(await p, { type: 'exec-result', exitCode: 0, output: 'ok', truncated: false });
});

test('other exec-error reasons (denied, timeout) settle immediately, before the grace', async () => {
  const ch = new FakeChannel();
  const exec = createExecClient(ch, { graceMs: 200 });
  const p = exec.run('sh', 'rm', 5000);
  ch.emit({ type: 'exec-error', id: ch.posts[0].id, reason: 'denied' });
  const result = await Promise.race([p, sleep(30).then(() => 'still-open')]);
  assert.equal(result.type, 'exec-error', 'not swallowed by the grace');
  assert.equal(result.reason, 'denied');
});

test('cancelAll posts an exec-cancel per open run and settles them cancelled', async () => {
  const ch = new FakeChannel();
  const exec = createExecClient(ch);
  const a = exec.run('sh', 'a', 5000);
  const b = exec.run('sh', 'b', 5000);
  const ids = ch.posts.map((m) => m.id);
  exec.cancelAll();
  const cancels = ch.posts.filter((m) => m.type === 'exec-cancel');
  assert.deepEqual([...cancels.map((m) => m.id)].sort(), [...ids].sort(), 'one exec-cancel per open run');
  assert.deepEqual(await a, { type: 'exec-error', id: ids[0], reason: 'cancelled' });
  assert.deepEqual(await b, { type: 'exec-error', id: ids[1], reason: 'cancelled' });
  ch.emit({ type: 'exec-result', id: ids[0], exitCode: 0, output: 'late' }); // a late reply cannot re-settle
});

test('the wall timer posts exec-cancel and settles no-terminal', async () => {
  const ch = new FakeChannel();
  const exec = createExecClient(ch, { wallExtraMs: 60 });
  const p = exec.run('sh', 'long', 100); // wall = 100 + 60 = 160 ms
  const id = ch.posts[0].id;
  const result = await p;
  assert.deepEqual(result, { type: 'exec-error', id, reason: 'no-terminal' });
  assert.ok(ch.posts.some((m) => m.type === 'exec-cancel' && m.id === id), 'the wall timer tells the terminal page to cancel');
});

test('a not-running reply from another tab after an exec-pending ack does not fail the run', async () => {
  const ch = new FakeChannel();
  const exec = createExecClient(ch, { graceMs: 10 });
  let settled = null; const p = exec.run('sh', 'echo hi', 5000).then((r) => { settled = r; return r; });
  const id = ch.posts[0].id;
  ch.emit({ type: 'exec-pending', id }); // tab A shows the prompt
  ch.emit({ type: 'exec-error', id, reason: 'not-running' }); // tab B has no running guest
  await sleep(40);
  assert.equal(settled, null, 'still waiting for tab A');
  ch.emit({ type: 'exec-result', id, exitCode: 0, output: 'hi\n' });
  assert.equal((await p).output, 'hi\n');
});

test('after exec-started, a busy reply from that terminal settles at once', async () => {
  const ch = new FakeChannel();
  const exec = createExecClient(ch, { graceMs: 5000 });
  const p = exec.run('sh', 'echo hi', 5000);
  const id = ch.posts[0].id;
  ch.emit({ type: 'exec-pending', id });
  ch.emit({ type: 'exec-started', id }); // the user clicked Run
  ch.emit({ type: 'exec-error', id, reason: 'busy' }); // the shell was not at its prompt
  assert.equal((await p).reason, 'busy');
});
