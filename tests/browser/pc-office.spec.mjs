import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';

const DOCS = 'pc:docs:v1';
async function open(page, app) { await page.goto(`/pc/apps/${app}/`); await expect(page.locator('#status')).toHaveText('Saved in this browser'); }
async function downloaded(page, selector) { const pending = page.waitForEvent('download'); await page.locator(selector).click(); return readFile(await (await pending).path()); }
function accept(page) { page.on('dialog', dialog => dialog.accept()); }
async function failWrites(page) { await page.evaluate(() => { window.originalSetItem = Storage.prototype.setItem; Storage.prototype.setItem = function () { throw new DOMException('Quota full', 'QuotaExceededError'); }; }); }
async function restoreWrites(page) { await page.evaluate(() => { Storage.prototype.setItem = window.originalSetItem; }); }

test('Docs edits, formats and immediately reloads with no external requests', async ({ page }) => {
  const external = [], errors = [];
  page.on('request', r => { if (/^https?:/.test(r.url()) && new URL(r.url()).hostname !== '127.0.0.1') external.push(r.url()); });
  page.on('pageerror', e => errors.push(e.message));
  await open(page, 'docs');
  const editor = page.locator('[contenteditable=true]');
  await page.locator('.layout-paragraph').first().click(); await page.keyboard.type('A useful local document'); await editor.press('ControlOrMeta+a');
  await page.getByTestId('toolbar-bold').click();
  await expect.poll(() => page.evaluate(() => JSON.stringify(window.webpcDocs.getContent()).includes('"bold":true'))).toBe(true);
  await page.locator('#name').fill('Field notes');
  await editor.press('End'); await page.keyboard.type(' — saved now');
  await page.reload(); await expect(page.locator('#export')).toBeEnabled();
  await expect(editor).toContainText('A useful local document'); await expect(editor).toContainText('saved now');
  await expect(page.locator('#name')).toHaveValue('Field notes');
  expect(external).toEqual([]); expect(errors).toEqual([]);
});

test('Docs DOCX and JSON roundtrip, recovery, malformed input and failed replacement preserve content', async ({ page }) => {
  accept(page); await open(page, 'docs'); await page.locator('[contenteditable=true]').fill('Roundtrip document');
  const backup = await downloaded(page, '#backup'), docx = await downloaded(page, '#export');
  const zip = await JSZip.loadAsync(docx); expect(await zip.file('word/document.xml').async('string')).toContain('Roundtrip document');
  await page.locator('#new').click(); await expect(page.locator('[contenteditable=true]')).not.toContainText('Roundtrip document');
  await page.locator('#file').setInputFiles({ name: 'notes.docx', mimeType: 'application/octet-stream', buffer: docx });
  await expect(page.locator('[contenteditable=true]')).toContainText('Roundtrip document');
  await page.locator('#new').click(); await page.locator('#file').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: backup });
  await expect(page.locator('[contenteditable=true]')).toContainText('Roundtrip document');
  const saved = await page.evaluate(key => localStorage.getItem(key), DOCS);
  for (const data of ['{broken', JSON.stringify({format:'webpc-docs',version:1,name:'bad',document:{package:{document:{content:[null]}}}})]) {
    await page.locator('#file').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from(data) });
    await expect(page.locator('#error')).toContainText('not replaced');
    expect(await page.evaluate(key => localStorage.getItem(key), DOCS)).toBe(saved);
  }
  await failWrites(page); await page.locator('#new').click();
  await expect(page.locator('#error')).toContainText('not replaced'); await expect(page.locator('[contenteditable=true]')).toContainText('Roundtrip document');
  expect(await page.evaluate(key => localStorage.getItem(key), DOCS)).toBe(saved);
  await restoreWrites(page); await page.locator('#new').click(); await page.locator('#recover').click();
  await expect(page.locator('[contenteditable=true]')).toContainText('Roundtrip document');
});

test('Docs exposes storage errors, saves edits during export, and protects corrupt startup data', async ({ page }) => {
  await open(page, 'docs'); await failWrites(page);
  await page.locator('[contenteditable=true]').fill('Unsaved draft');
  await expect(page.locator('#error')).toContainText('Local save failed');
  expect(await page.evaluate(() => window.pcBeforeClose())).toBe(false);
  const backup = JSON.parse((await downloaded(page, '#backup')).toString()); expect(JSON.stringify(backup)).toContain('Unsaved draft');
  await restoreWrites(page); await page.locator('#retry').click();
  await page.evaluate(() => {
    // React recreates this imperative handle on document/selection updates.
    // Wrap each new handle so focus changes cannot silently remove our gate.
    let current;
    const wrap = api => { const original = api.save; api.save = async () => { await new Promise(resolve => { window.releaseExport = resolve; }); return original(); }; return api; };
    const initial = window.webpcDocs;
    Object.defineProperty(window, 'webpcDocs', { configurable: true, get: () => current, set: api => { current = wrap(api); } });
    window.webpcDocs = initial;
  });
  await page.locator('#export').click(); await expect.poll(() => page.evaluate(() => typeof window.releaseExport)).toBe('function');
  await page.locator('[contenteditable=true]').fill('Typed during export');
  expect(await page.evaluate(key => localStorage.getItem(key).includes('Typed during export'), DOCS)).toBe(true);
  expect(await page.evaluate(() => window.pcBeforeClose())).toBe(false);
  const download = page.waitForEvent('download'); await page.evaluate(() => window.releaseExport()); await download;
  expect(await page.evaluate(() => window.pcBeforeClose())).toBe(true);
  await page.evaluate(key => localStorage.setItem(key, '{corrupt'), DOCS); await page.reload();
  await expect(page.locator('#error')).toContainText('left untouched');
  expect(await page.evaluate(key => localStorage.getItem(key), DOCS)).toBe('{corrupt');
  expect((await downloaded(page, '#raw')).toString()).toBe('{corrupt');
});

test('Docs load failure is visible and leaves storage untouched', async ({ page }) => {
  await page.route('**/pc/vendor/docs/editor.js', route => route.abort());
  await page.goto('/pc/apps/docs/'); await expect(page.locator('#error')).toContainText('could not load');
  expect(await page.evaluate(key => localStorage.getItem(key), DOCS)).toBeNull();
});

test('Docs participates in desktop close/reopen and fit a narrow viewport', async ({ page }) => {
  await page.goto('/pc/');
  for (const app of ['docs']) {
    await page.locator(`[data-shortcut="${app}"]`).dblclick();
    const win = page.locator(`[data-window="${app}"]`);
    await expect(win).toHaveAttribute('data-load', 'ready');
    const frame = page.frameLocator(`[data-window="${app}"] iframe`);
    if (app === 'docs') { await frame.locator('.layout-paragraph').first().click(); await page.keyboard.type('Close and reopen draft'); }
    await page.getByRole('button', {name:`Close Docs`,exact:true}).click();
    await expect(win).toBeHidden(); await page.locator(`[data-shortcut="${app}"]`).dblclick();
    if (app === 'docs') await expect(frame.locator('[contenteditable=true]')).toContainText('Close and reopen draft');
    await page.getByRole('button', {name:`Close Docs`,exact:true}).click();
  }
  await page.setViewportSize({width:390,height:844}); await page.goto('/pc/apps/docs/');
  await expect.poll(() => page.evaluate(() => window.webpcDocs?.getZoom())).toBeLessThan(.5);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
});
