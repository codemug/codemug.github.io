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
  channel.onmessage = event => { const d = event.data; if (d && (d.type === 'exec-result' || d.type === 'exec-error')) { const resolve = pending.get(d.id); if (resolve) { pending.delete(d.id); resolve(d); } } };
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
 await page.screenshot({ path: testInfo.outputPath('exec-approval.png') });
 await page.locator('#exec-deny').click();
 expect(await denied).toEqual({ type: 'exec-error', id: 'denied', reason: 'denied' });
 expect(await page.locator('#exec-prompt').isVisible()).toBe(false);
 const hello = await run('echo-hello', 'echo hello');
 expect(hello).toMatchObject({ type: 'exec-result', exitCode: 0, truncated: false });
 expect(hello.output).toMatch(/hello/);
 const py = await run('py-add', 'print(2+2)', 'python');
 expect(py).toMatchObject({ type: 'exec-result', exitCode: 0, truncated: false });
 expect(py.output).toMatch(/4/);
 expect(py.output).not.toContain('print(');
 expect(py.output).not.toContain('WEBPC_EOF_');
 const node = await run('node-map', 'console.log([1,2].map(x=>x*3))', 'node');
 expect(node).toMatchObject({ type: 'exec-result', exitCode: 0 });
 expect(node.output).toMatch(/\[ 3, 6 \]/);
 expect(node.output).not.toContain('console.log');
 const failed = await run('sh-fail', 'false');
 expect(failed).toMatchObject({ type: 'exec-result', exitCode: 1 });
 // A timeout sends Ctrl+C and replies with the partial output; the shell is usable afterwards.
 const slow = await run('sh-slow', 'sleep 100; echo NEVER_DONE', 'sh', 3000);
 expect(slow).toMatchObject({ type: 'exec-error', reason: 'timeout' });
 expect(typeof slow.output).toBe('string');
 expect(slow.output).not.toContain('NEVER_DONE');
 const recovered = await run('recover', 'echo ok');
 expect(recovered).toMatchObject({ type: 'exec-result', exitCode: 0 });
 expect(recovered.output).toMatch(/ok/);
 // Only one run at a time: a second request while one is running gets busy.
 const first = post(execRequest('busy-first', 'sleep 5'));
 await page.locator('#exec-prompt').waitFor({ state: 'visible', timeout: 20000 });
 await page.locator('#exec-run').click();
 expect(await post(execRequest('busy-second', 'echo busy'))).toEqual({ type: 'exec-error', id: 'busy-second', reason: 'busy' });
 expect(await first).toMatchObject({ type: 'exec-result', exitCode: 0 });
 expect(external).toEqual([]);
});
