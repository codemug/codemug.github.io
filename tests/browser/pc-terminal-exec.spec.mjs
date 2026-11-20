import { test, expect } from '@playwright/test';
const screen = page => page.locator('.xterm-rows');
const shellReady = async page => expect.poll(async () => (await screen(page).textContent()).trim().endsWith('webpc:~#'), { timeout:10000 }).toBe(true);
const ready = async page => { await page.getByRole('button', { name: 'Start Linux', exact: true }).click(); await expect(page.getByRole('button', { name: 'Save session', exact: true })).toBeEnabled({ timeout: 120000 }); };
const execRequest = (id, code, lang = 'sh', timeoutMs = 30000) => ({ type: 'exec-request', id, from: 'Terminal Exec Spec', lang, code, timeoutMs });

test('the terminal exec service runs approved commands and reports results over BroadcastChannel', async ({ page, baseURL }, testInfo) => {
  test.setTimeout(300000); page.on('dialog', dialog => dialog.accept());
  const external=[];
  const trackExternal = request => { if (/^https?:/.test(request.url()) && new URL(request.url()).origin !== new URL(baseURL).origin) external.push(request.url()); };
  page.on('request', trackExternal);
  await page.goto('/pc/apps/terminal/');
  // A second same-origin page (the Files app) plays the requesting app: a second terminal
  // page would answer its own requests through its own channel listener.
  const requester = await page.context().newPage(); requester.on('request', trackExternal);
  await requester.goto('/pc/apps/files/');
  await requester.evaluate(() => {
   const channel = new BroadcastChannel('webpc-terminal'); const pending = new Map();
   window.__execTraffic = [];
   channel.onmessage = event => { const d = event.data; window.__execTraffic.push(d); if (d && (d.type === 'exec-result' || d.type === 'exec-error')) { const resolve = pending.get(d.id); if (resolve) { pending.delete(d.id); resolve(d); } } };
   window.__exec = request => new Promise((resolve, reject) => { pending.set(request.id, resolve); channel.postMessage(request); setTimeout(() => { if (pending.has(request.id)) { pending.delete(request.id); reject(new Error(`no exec response within 120 s for ${request.id}`)); } }, 120000); });
  });
  const post = request => requester.evaluate(r => window.__exec(r), request);
  const run = async (id, code, lang, timeoutMs) => {
   const response = post(execRequest(id, code, lang, timeoutMs));
   await page.locator('#exec-prompt').waitFor({ state: 'visible', timeout: 20000 });
   await page.locator('#exec-run').click();
   return response;
  };
  // A request before boot gets not-running, and the guest is never auto-started.
  expect(await post(execRequest('pre-boot', 'echo early'))).toEqual({ type: 'exec-error', id: 'pre-boot', reason: 'not-running' });
  await ready(page); await shellReady(page);
  // Every run needs an approval click; the prompt is keyboard accessible (Deny focused first).
  const denied = post(execRequest('denied', 'echo never'));
  await page.locator('#exec-prompt').waitFor({ state: 'visible', timeout: 20000 });
  expect(await page.locator('#exec-code').textContent()).toBe('echo never');
  expect(await page.locator('#exec-meta').textContent()).toContain('Terminal Exec Spec');
  expect(await page.evaluate(() => document.activeElement.id)).toBe('exec-deny');
  // Protocol: the Terminal announces the pending approval.
  expect(await requester.evaluate(() => window.__execTraffic)).toEqual(expect.arrayContaining([{ type: 'exec-pending', id: 'denied' }]));
  await page.screenshot({ path: testInfo.outputPath('exec-approval.png') });
  await page.locator('#exec-deny').click();
  expect(await denied).toEqual({ type: 'exec-error', id: 'denied', reason: 'denied' });
  expect(await page.locator('#exec-prompt').isVisible()).toBe(false);
  // The prompt renders what will run: C0 controls and invisible characters are visible.
  const crafted = post(execRequest('crafted', 'echo a\rb\x00c'));
  await page.locator('#exec-prompt').waitFor({ state: 'visible', timeout: 20000 });
  expect(await page.locator('#exec-code').textContent()).toBe('echo a\\x0db\\x00c');
  await page.locator('#exec-deny').click();
  expect(await crafted).toEqual({ type: 'exec-error', id: 'crafted', reason: 'denied' });
  // A programmatic (untrusted) Run click is not an approval: the prompt stays.
  const untrusted = post(execRequest('untrusted', 'echo never'));
  await page.locator('#exec-prompt').waitFor({ state: 'visible', timeout: 20000 });
  await page.locator('#exec-run').evaluate(el => el.click());
  await page.waitForTimeout(500);
  expect(await page.locator('#exec-prompt').isVisible()).toBe(true, 'an untrusted click must not run or clear the prompt');
  await page.locator('#exec-deny').click();
  expect(await untrusted).toEqual({ type: 'exec-error', id: 'untrusted', reason: 'denied' });
  // Two-Terminal loop guard: a reply-shaped message on the channel gets no answer. The
  // requester's own listener also sees the posted reply (another channel instance on the
  // page), so only an `invalid` answer, which is what the old Terminal sent back, counts.
  await requester.evaluate(() => { const c = new BroadcastChannel('webpc-terminal'); c.postMessage({ type: 'exec-error', id: 'loop-x', reason: 'not-running' }); });
  await page.waitForTimeout(1500);
  expect(await requester.evaluate(() => window.__execTraffic.filter(m => m && m.id === 'loop-x').map(m => m.reason))).toEqual(['not-running']);
  const hello = await run('echo-hello', 'echo hello');
  expect(hello).toMatchObject({ type: 'exec-result', exitCode: 0, truncated: false });
  expect(hello.output).toBe('hello\n');
  const py = await run('py-add', 'print(2+2)', 'python');
  expect(py).toMatchObject({ type: 'exec-result', exitCode: 0, truncated: false });
  expect(py.output).toBe('4\n');
  expect(py.output).not.toContain('print(');
  const node = await run('node-map', 'console.log([1,2].map(x=>x*3))', 'node');
  expect(node).toMatchObject({ type: 'exec-result', exitCode: 0 });
  expect(node.output).toBe('[ 3, 6 ]\n');
  expect(node.output).not.toContain('console.log');
  // Long sh command (over 80 columns, 21-char id): the wrapped echo must not reach the
  // captured output; a trailing "# comment" must not hide the sentinel.
  const longId = 'term-exec-long-abcdef';
  expect(longId.length).toBe(21);
  const long = await run(longId, `echo ${'x'.repeat(90)}`);
  expect(long).toMatchObject({ type: 'exec-result', exitCode: 0, truncated: false });
  expect(long.output).toBe('x'.repeat(90) + '\n');
  const commented = await run('sh-comment', 'echo done # trailing comment');
  expect(commented).toMatchObject({ type: 'exec-result', exitCode: 0 });
  expect(commented.output).toBe('done\n');
  const failed = await run('sh-fail', 'false');
  expect(failed).toMatchObject({ type: 'exec-result', exitCode: 1 });
  // A timeout sends Ctrl+C and replies with the partial output; the shell is usable afterwards.
  const slow = await run('sh-slow', 'sleep 100; echo NEVER_DONE', 'sh', 3000);
  expect(slow).toMatchObject({ type: 'exec-error', reason: 'timeout' });
  expect(typeof slow.output).toBe('string');
  expect(slow.output).not.toContain('NEVER_DONE');
  const recovered = await run('recover', 'echo ok');
  expect(recovered).toMatchObject({ type: 'exec-result', exitCode: 0 });
  expect(recovered.output).toBe('ok\n');
  // Only one run at a time: a second request while one is running gets busy.
  const first = post(execRequest('busy-first', 'sleep 5'));
  await page.locator('#exec-prompt').waitFor({ state: 'visible', timeout: 20000 });
  await page.locator('#exec-run').click();
  // Protocol: the approved run announces itself over the channel.
  expect(await requester.evaluate(() => window.__execTraffic)).toEqual(expect.arrayContaining([{ type: 'exec-started', id: 'busy-first' }]));
  expect(await post(execRequest('busy-second', 'echo busy'))).toEqual({ type: 'exec-error', id: 'busy-second', reason: 'busy' });
  expect(await first).toMatchObject({ type: 'exec-result', exitCode: 0 });
  expect(external).toEqual([]);
 });
