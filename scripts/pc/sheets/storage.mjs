export const STORAGE_KEY = 'pc:sheets:v1';
export const RECOVERY_KEY = `${STORAGE_KEY}:previous`;
export const BACKUP_FORMAT = 'codemug-sheets';
export const MAX_FILE_BYTES = 20 * 1024 * 1024;

export function validateWorkbook(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data) ||
      typeof data.id !== 'string' || !data.id || !Array.isArray(data.sheetOrder) ||
      !data.sheetOrder.length || !data.sheets || typeof data.sheets !== 'object') {
    throw new Error('This file does not contain a valid spreadsheet workbook.');
  }
  if (new Set(data.sheetOrder).size !== data.sheetOrder.length ||
      data.sheetOrder.some(id => typeof id !== 'string' || !Object.hasOwn(data.sheets, id) ||
        !data.sheets[id] || typeof data.sheets[id] !== 'object' || Array.isArray(data.sheets[id]))) {
    throw new Error('This workbook has missing or duplicate worksheets.');
  }
  for (const id of data.sheetOrder) {
    const sheet = data.sheets[id];
    if (sheet.cellData != null && (typeof sheet.cellData !== 'object' || Array.isArray(sheet.cellData))) {
      throw new Error('This workbook contains invalid cell data.');
    }
  }
  // JSON snapshots are data, never executable code. Do not accept prototype keys.
  const visit = value => {
    if (!value || typeof value !== 'object') return;
    for (const key of Object.keys(value)) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
        throw new Error('This workbook contains an unsupported property.');
      }
      visit(value[key]);
    }
  };
  visit(data);
  return data;
}

export function encodeBackup(snapshot, now = new Date().toISOString()) {
  validateWorkbook(snapshot);
  return JSON.stringify({ format: BACKUP_FORMAT, version: 1, savedAt: now, workbook: snapshot });
}

export function decodeBackup(text) {
  let parsed;
  try { parsed = JSON.parse(text); } catch { throw new Error('The JSON backup could not be read.'); }
  if (parsed?.format !== BACKUP_FORMAT || parsed.version !== 1) {
    throw new Error('Choose a JSON backup exported by this spreadsheet app.');
  }
  return validateWorkbook(parsed.workbook);
}

export function readSaved(storage, key = STORAGE_KEY) {
  const text = storage.getItem(key);
  return text === null ? null : decodeBackup(text);
}

// setItem is atomic: quota/blocked-storage failures leave the previous save intact.
export function saveSnapshot(storage, snapshot, key = STORAGE_KEY) {
  const text = encodeBackup(snapshot);
  storage.setItem(key, text);
  return text;
}

export function blankWorkbook(name = 'Untitled workbook') {
  const id = `pc-${globalThis.crypto?.randomUUID?.() ?? Date.now()}`;
  return {
    id, name, appVersion: '0.25.0', locale: 'enUS', styles: {}, sheetOrder: ['sheet1'],
    sheets: { sheet1: { id: 'sheet1', name: 'Sheet 1', rowCount: 500, columnCount: 26,
      defaultColumnWidth: 110, defaultRowHeight: 24, cellData: {}, rowData: {}, columnData: {},
      mergeData: [], showGridlines: 1, zoomRatio: 1, scrollTop: 0, scrollLeft: 0 } },
  };
}

export function safeFilename(name) {
  return String(name || 'Workbook').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').slice(0, 100) || 'Workbook';
}
