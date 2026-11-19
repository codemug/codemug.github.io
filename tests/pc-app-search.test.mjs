import test from 'node:test';
import assert from 'node:assert/strict';
import { filterApps } from '../src/scripts/pc/app-search.mjs';
const apps = [
  { id: 'sheet', title: 'Sheets', description: 'Work with numbers', category: 'Office', keywords: ['Excel'] },
  { id: 'help', title: 'About WebPC', description: 'Keyboard help', category: 'System' },
];
test('app search matches all words across titles, descriptions and synonyms', () => {
  assert.deepEqual(filterApps(apps, '  EXCEL numbers ').map(app => app.id), ['sheet']);
  assert.deepEqual(filterApps(apps, 'Excel keyboard'), []);
  assert.deepEqual(filterApps(apps, '   '), apps);
});
test('app category and search combine without changing registry order', () => {
  assert.deepEqual(filterApps(apps, '', 'System').map(app => app.id), ['help']);
  assert.deepEqual(filterApps(apps, 'Excel', 'System'), []);
  assert.deepEqual(filterApps(apps, 'help', 'System').map(app => app.id), ['help']);
});
