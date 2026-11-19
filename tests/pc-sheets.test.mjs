import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { blankWorkbook, encodeBackup, decodeBackup, readSaved, saveSnapshot, STORAGE_KEY, RECOVERY_KEY, validateWorkbook } from '../scripts/pc/sheets/storage.mjs';
import { requireEditorApi, watchChanges, importXlsxAcrossFrame } from '../scripts/pc/sheets/adapter.mjs';

function memoryStorage() {
  const map = new Map();
  return { getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, value) };
}
test('spreadsheet backups preserve formulas, formatting and multiple sheets', () => {
  const data = blankWorkbook('Budget');
  data.sheets.sheet1.cellData = { 0: { 0: { f: '=SUM(A2:A3)', v: 42, s: { bl: 1 } } } };
  data.sheets.second = { id: 'second', name: 'Notes', cellData: { 0: { 0: { v: 'Keep me' } } } };
  data.sheetOrder.push('second');
  assert.deepEqual(decodeBackup(encodeBackup(data)), data);
});
test('malformed or unrelated JSON never becomes a workbook', () => {
  for (const text of ['{', '{}', '{"format":"codemug-sheets","version":2}', '{"format":"codemug-sheets","version":1,"workbook":{"id":"x","sheetOrder":["missing"],"sheets":{}}}']) {
    assert.throws(() => decodeBackup(text));
  }
  const data = blankWorkbook(); data.sheetOrder.push('sheet1');
  assert.throws(() => validateWorkbook(data), /duplicate/);
  assert.throws(() => validateWorkbook(JSON.parse('{"id":"x","sheetOrder":["s"],"sheets":{"s":{"__proto__":{}}}}')), /unsupported/);
});
test('failed save leaves previous persisted content and recovery intact', () => {
  const storage = memoryStorage(), old = blankWorkbook('Previous');
  saveSnapshot(storage, old); saveSnapshot(storage, old, RECOVERY_KEY);
  storage.setItem = () => { throw new Error('QuotaExceededError'); };
  assert.throws(() => saveSnapshot(storage, blankWorkbook('New')), /Quota/);
  assert.deepEqual(readSaved(storage), old);
  assert.deepEqual(readSaved(storage, RECOVERY_KEY), old);
});
test('corrupt saved content is reported and not changed', () => {
  const storage = memoryStorage(); storage.setItem(STORAGE_KEY, '{damaged');
  assert.throws(() => readSaved(storage), /could not be read/);
  assert.equal(storage.getItem(STORAGE_KEY), '{damaged');
});
test('version seam fails explicitly when SDK API changes', () => {
  assert.equal(requireEditorApi({}), null);
  assert.throws(() => requireEditorApi({ __casualEmbedApi: {} }), /adapter mismatch/);
});
test('mutation autosave runs before delayed change event and stops on cleanup', async () => {
  const events = new Map(); let mutation, saves = 0, off = 0;
  const api = { onMutation(fn) { mutation = fn; return () => off++; }, on(name, fn) { events.set(name, fn); return () => off++; } };
  const stop = watchChanges(api, () => saves++, () => {});
  mutation(); mutation(); assert.equal(saves, 0);
  await Promise.resolve(); assert.equal(saves, 1);
  mutation(); stop(); await Promise.resolve(); assert.equal(saves, 1); assert.equal(off, 4);
});

test('XLSX byte import uses the editor realm, not the host typed-array constructor', async () => {
  const FrameArray = runInNewContext('Uint8Array');
  const bytes = new Uint8Array([80, 75, 3, 4]);
  assert.equal(bytes instanceof FrameArray, false);
  let imported;
  await importXlsxAcrossFrame({ importXlsx(value) { imported = value; } }, { Uint8Array: FrameArray }, bytes);
  assert.equal(imported instanceof FrameArray, true);
  assert.deepEqual([...imported], [...bytes]);
});
