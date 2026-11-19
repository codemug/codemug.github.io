import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const KEY = 'pc:sheets:v1';
async function open(page) {
  await page.goto('/pc/apps/sheets/');
  await expect(page.getByRole('button', { name: 'Export XLSX', exact: true })).toBeEnabled({ timeout: 25_000 });
  return page.frames().find(frame => frame.url().includes('/sheets/editor/'));
}
async function writeCell(editor, address, value, commit = true) {
  const name = editor.getByRole('textbox', { name: 'Name box', exact: true });
  await name.fill(address); await name.press('Enter');
  const formula = editor.getByRole('textbox', { name: 'Formula bar', exact: true });
  await formula.fill(value);
  if (commit) await formula.press('Enter');
}
async function value(editor, address) {
  return editor.evaluate(address => window.__casualEmbedApi.univer.getActiveWorkbook().getActiveSheet().getRange(address).getValue(), address);
}
async function snapshot(editor) { return editor.evaluate(() => window.__casualEmbedApi.getContent()); }

test('Sheets edits real UI, calculates SUM, formats, adds sheets and saves without external requests', async ({ page, baseURL }) => {
  const external = [], errors = [];
  page.on('request', request => { if (!request.url().startsWith(`${new URL(baseURL).origin}/`)) external.push(request.url()); });
  page.on('pageerror', error => errors.push(error.message));
  const editor = await open(page);
  await writeCell(editor, 'A1', '12'); await writeCell(editor, 'A2', '30');
  await writeCell(editor, 'A3', '=SUM(A1:A2)');
  await expect.poll(() => value(editor, 'A3')).toBe(42);
  await editor.getByRole('textbox', { name: 'Name box', exact: true }).fill('A1');
  await editor.getByRole('textbox', { name: 'Name box', exact: true }).press('Enter');
  await editor.getByRole('button', { name: 'Bold (Ctrl+B)', exact: true }).click();
  await expect.poll(async () => {
    const data = await snapshot(editor), cell = data.sheets[data.sheetOrder[0]].cellData[0][0];
    return (typeof cell.s === 'string' ? data.styles[cell.s] : cell.s)?.bl;
  }).toBe(1);
  await editor.getByRole('button', { name: 'Add sheet', exact: true }).click();
  await expect.poll(async () => (await snapshot(editor)).sheetOrder.length).toBe(2);
  await page.getByRole('textbox', { name: 'Workbook name', exact: true }).fill('My calculations');
  await expect(page.locator('#save-status')).toHaveText('Saved in this browser');
  await expect(editor.getByRole('button', { name: 'Insert chart', exact: true })).toHaveCount(0);
  expect(external).toEqual([]); expect(errors).toEqual([]);
});

test('Sheets saves uncommitted formula-bar text on immediate reload', async ({ page }) => {
  let editor = await open(page);
  await writeCell(editor, 'B2', 'No Enter before reload', false);
  await page.reload();
  await expect(page.locator('#export-xlsx')).toBeEnabled();
  editor = page.frames().find(frame => frame.url().includes('/sheets/editor/'));
  await expect.poll(async () => (await snapshot(editor)).sheets.sheet1.cellData[1]?.[1]?.v).toBe('No Enter before reload');
});

test('Sheets commits a grid-cell edit on reload, before the change debounce', async ({ page }) => {
  let editor = await open(page);
  await editor.locator('canvas').last().dblclick({ position: { x: 85, y: 32 } });
  await page.keyboard.type('Grid draft');
  await page.reload();
  await expect(page.locator('#export-xlsx')).toBeEnabled();
  editor = page.frames().find(frame => frame.url().includes('/sheets/editor/'));
  await expect.poll(async () => (await snapshot(editor)).sheets.sheet1.cellData[0]?.[0]?.v).toBe('Grid draft');
});

test('Sheets JSON and XLSX roundtrip preserve two sheets, formulas and values', async ({ page }, testInfo) => {
  const editor = await open(page);
  await writeCell(editor, 'A1', '7'); await writeCell(editor, 'A2', '=A1*6');
  await expect.poll(() => value(editor, 'A2')).toBe(42);
  await editor.getByRole('button', { name: 'Add sheet', exact: true }).click();
  await writeCell(editor, 'B2', 'Second sheet');
  for (const [label, extension] of [['Backup JSON', 'json'], ['Export XLSX', 'xlsx']]) {
    const waiting = page.waitForEvent('download');
    await page.getByRole('button', { name: label, exact: true }).click();
    const download = await waiting, path = testInfo.outputPath(`roundtrip.${extension}`);
    await download.saveAs(path);
    if (extension === 'json') expect(JSON.parse(await readFile(path, 'utf8')).workbook.sheetOrder).toHaveLength(2);
    else expect((await readFile(path)).subarray(0, 2).toString()).toBe('PK');
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: 'New', exact: true }).click();
    await expect.poll(async () => (await snapshot(editor)).sheetOrder.length).toBe(1);
    page.once('dialog', dialog => dialog.accept());
    await page.locator('#file-input').setInputFiles(path);
    await expect.poll(async () => (await snapshot(editor)).sheetOrder.length).toBe(2);
    const data = await snapshot(editor);
    expect(data.sheets[data.sheetOrder[0]].cellData[1][0].f).toBe('=A1*6');
    expect(data.sheets[data.sheetOrder[1]].cellData[1][1].v).toBe('Second sheet');
  }
});

test('Sheets rejects bad files and keeps recovery available after New', async ({ page }) => {
  const editor = await open(page);
  await writeCell(editor, 'A1', 'Keep this');
  await page.locator('#file-input').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{broken') });
  await expect(page.locator('#error-box')).toContainText('not replaced');
  expect(await value(editor, 'A1')).toBe('Keep this');
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#file-input').setInputFiles({ name: 'broken.xlsx', mimeType: 'application/octet-stream', buffer: Buffer.from('PKbroken') });
  await expect(page.locator('#error-box')).toContainText('not replaced');
  expect(await value(editor, 'A1')).toBe('Keep this');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await expect.poll(() => value(editor, 'A1')).toBe(null);
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Recover previous', exact: true }).click();
  await expect.poll(() => value(editor, 'A1')).toBe('Keep this');
});

test('Sheets quota failure keeps old save, exposes export, and refuses close', async ({ page }) => {
  const editor = await open(page);
  await writeCell(editor, 'A1', 'Saved before quota');
  await expect.poll(() => page.evaluate(key => localStorage.getItem(key), KEY)).toContain('Saved before quota');
  const before = await page.evaluate(key => localStorage.getItem(key), KEY);
  await page.evaluate(() => { Storage.prototype.setItem = () => { throw new DOMException('full', 'QuotaExceededError'); }; });
  await writeCell(editor, 'A1', 'Keep in memory');
  await expect(page.locator('#error-box')).toContainText('Could not save');
  expect(await page.evaluate(() => window.pcBeforeClose())).toBe(false);
  expect(await page.evaluate(key => localStorage.getItem(key), KEY)).toBe(before);
  expect(await value(editor, 'A1')).toBe('Keep in memory');
  await expect(page.getByRole('button', { name: 'Backup JSON', exact: true })).toBeEnabled();
});

test('Sheets preserves corrupt saved data and reports failed network loads', async ({ page }) => {
  await page.addInitScript(key => { if (window === top) localStorage.setItem(key, '{damaged'); }, KEY);
  await open(page);
  await expect(page.locator('#error-box')).toContainText('left untouched');
  expect(await page.evaluate(key => localStorage.getItem(key), KEY)).toBe('{damaged');
  await page.route('**/pc/vendor/sheets/embed-runtime.js', route => route.abort());
  await page.reload();
  await expect(page.locator('#error-box')).toContainText('could not load');
  expect(await page.evaluate(key => localStorage.getItem(key), KEY)).toBe('{damaged');
});

test('real Sheets stays lazy and survives desktop close/reopen and theme changes', async ({ page }) => {
  const loaded = [];
  page.on('request', request => { if (request.url().includes('/pc/vendor/sheets/')) loaded.push(request.url()); });
  await page.goto('/pc/'); expect(loaded).toEqual([]);
  await page.locator('[data-shortcut="sheets"]').dblclick();
  await expect(page.locator('[data-window="sheets"]')).toHaveAttribute('data-load', 'ready', { timeout: 25_000 });
  const app = page.frames().find(frame => /\/pc\/apps\/sheets\/$/.test(frame.url()));
  const editor = page.frames().find(frame => frame.url().includes('/sheets/editor/'));
  await writeCell(editor, 'A1', 'Desktop keeps this', false);
  await page.getByRole('button', { name: 'Close Sheets', exact: true }).click();
  await expect(page.locator('[data-window="sheets"]')).toBeHidden();
  await page.locator('[data-shortcut="sheets"]').dblclick();
  await expect.poll(() => value(editor, 'A1')).toBe('Desktop keeps this');
  await page.evaluate(() => {
    document.querySelector('[data-window="sheets"] iframe').contentWindow.postMessage({ type: 'pc:theme', theme: 'light' }, location.origin);
  });
  await expect(app.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('Sheets remains usable at narrow width', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 760 });
  const editor = await open(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  await expect(page.getByRole('button', { name: 'Backup JSON', exact: true })).toBeInViewport();
  await expect(editor.getByRole('textbox', { name: 'Formula bar', exact: true })).toBeInViewport();
  await writeCell(editor, 'A1', 'Mobile');
  await expect.poll(() => value(editor, 'A1')).toBe('Mobile');
});

test('Sheets reports a failed formula worker instead of leaving loading indefinitely', async ({ page }) => {
  await page.route('**/pc/vendor/sheets/formula.worker.js', route => route.abort());
  await page.goto('/pc/apps/sheets/');
  await expect(page.locator('#error-box')).toContainText('formula worker could not initialize', { timeout: 20_000 });
  await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
  expect(await page.evaluate(key => localStorage.getItem(key), KEY)).toBeNull();
});

async function canvasSize(editor) {
  return editor.evaluate(() => {
    const canvas = [...document.querySelectorAll('canvas')].at(-1);
    const rect = canvas.getBoundingClientRect(), parent = canvas.parentElement;
    return { width: rect.width, height: rect.height, containerWidth: parent.clientWidth, containerHeight: parent.clientHeight, backingWidth: canvas.width, backingHeight: canvas.height, ratio: devicePixelRatio };
  });
}
async function expectCanvasFits(editor) {
  await expect.poll(async () => {
    const s = await canvasSize(editor);
    return Math.abs(s.width - s.containerWidth) + Math.abs(s.height - s.containerHeight);
  }).toBeLessThan(2);
  const s = await canvasSize(editor);
  expect(Math.abs(s.backingWidth - s.width * s.ratio)).toBeLessThan(2);
  expect(Math.abs(s.backingHeight - s.height * s.ratio)).toBeLessThan(2);
  return s;
}

test('Sheets canvas follows maximize, restore and pointer resize without losing edits or undo', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({width:1600,height:1000}); await page.goto('/pc/');
  await page.locator('[data-shortcut="sheets"]').dblclick();
  const win = page.locator('[data-window="sheets"]'); await expect(win).toHaveAttribute('data-load','ready',{timeout:25000});
  const editor = page.frames().find(frame => frame.url().includes('/sheets/editor/'));
  await writeCell(editor, 'A1', 'Keep original'); const id = (await snapshot(editor)).id;
  const original = await expectCanvasFits(editor);
  await page.getByRole('button',{name:'Maximize Sheets',exact:true}).click();
  const expanded = await expectCanvasFits(editor); expect(expanded.width).toBeGreaterThan(original.width + 400); expect(expanded.height).toBeGreaterThan(original.height + 150);
  // Click a real cell beyond BOTH old canvas dimensions, then type through the
  // grid editor. A CSS-only canvas stretch would map this click incorrectly.
  const cell = await editor.evaluate(() => { const r = window.__casualEmbedApi.univer.getActiveWorkbook().getActiveSheet().getRange('M20').getCellRect(); return {x:(r.left+r.right)/2,y:(r.top+r.bottom)/2}; });
  expect(cell.x).toBeGreaterThan(original.width); expect(cell.y).toBeGreaterThan(original.height);
  await editor.locator('canvas').last().dblclick({position:cell}); await page.keyboard.type('Expanded cell'); await page.keyboard.press('Enter');
  await expect.poll(() => value(editor,'M20')).toBe('Expanded cell');
  await page.getByRole('button',{name:'Restore Sheets',exact:true}).click();
  const restored = await expectCanvasFits(editor); expect(restored.width).toBe(original.width); expect(restored.height).toBe(original.height);
  const grip = await win.locator('.pc-resize').boundingBox();
  await page.mouse.move(grip.x+10,grip.y+10); await page.mouse.down(); await page.mouse.move(grip.x+160,grip.y+110,{steps:6}); await page.mouse.up();
  const resized = await expectCanvasFits(editor); expect(resized.width).toBeGreaterThan(restored.width+100); expect(resized.height).toBeGreaterThan(restored.height+50);
  expect((await snapshot(editor)).id).toBe(id); expect(await value(editor,'A1')).toBe('Keep original'); expect(await value(editor,'M20')).toBe('Expanded cell');
  await editor.evaluate(() => window.__casualEmbedApi.undo()); await expect.poll(() => value(editor,'M20')).toBe(null);
  await editor.evaluate(() => window.__casualEmbedApi.redo()); await expect.poll(() => value(editor,'M20')).toBe('Expanded cell');
  await page.getByRole('button',{name:'Minimize Sheets',exact:true}).click(); await page.getByRole('button',{name:'Switch to Sheets',exact:true}).click(); await expectCanvasFits(editor);
  await page.screenshot({path:'/tmp/webpc-sheets-resize-restored.png'});
  await page.getByRole('button',{name:'Maximize Sheets',exact:true}).click(); await expectCanvasFits(editor); await page.screenshot({path:'/tmp/webpc-sheets-resize-maximized.png'});
  expect(errors).toEqual([]);
});

test.describe('Sheets high density narrow resize', () => {
  test.use({deviceScaleFactor:2});
  test('Sheets canvas follows orientation and a replacement workbook', async ({ page }) => {
    await page.setViewportSize({width:390,height:844}); const editor = await open(page);
    const portrait = await expectCanvasFits(editor); await writeCell(editor,'A1','Portrait draft');
    await page.setViewportSize({width:844,height:390}); const landscape = await expectCanvasFits(editor);
    expect(landscape.width).toBeGreaterThan(portrait.width); expect(landscape.height).toBeLessThan(portrait.height); expect(await value(editor,'A1')).toBe('Portrait draft');
    page.once('dialog',dialog=>dialog.accept()); await page.getByRole('button',{name:'New',exact:true}).click(); await expect.poll(()=>value(editor,'A1')).toBe(null);
    await page.setViewportSize({width:390,height:844}); await expectCanvasFits(editor); await writeCell(editor,'B2','New portrait'); await expect.poll(()=>value(editor,'B2')).toBe('New portrait');
  });
});
