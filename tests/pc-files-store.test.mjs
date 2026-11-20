import test from 'node:test';
import assert from 'node:assert/strict';

// Minimal in-memory OPFS: kind mismatches throw TypeMismatchError, like the real one.
const fail = name => Object.assign(new Error(name), { name });
class Dir {
  kind = 'directory'; map = new Map();
  async getDirectoryHandle(n, { create } = {}) { const e = this.map.get(n); if (e) { if (e.kind !== 'directory') throw fail('TypeMismatchError'); return e; } if (!create) throw fail('NotFoundError'); const d = new Dir(); this.map.set(n, d); return d; }
  async getFileHandle(n, { create } = {}) { const e = this.map.get(n); if (e) { if (e.kind !== 'file') throw fail('TypeMismatchError'); return e; } if (!create) throw fail('NotFoundError'); const f = new FileEntry(n); this.map.set(n, f); return f; }
  async *entries() { yield* this.map.entries(); }
  async removeEntry(n) { if (!this.map.delete(n)) throw fail('NotFoundError'); }
}
class FileEntry {
  kind = 'file'; bytes = new Uint8Array(); constructor(name) { this.name = name; }
  async getFile() { return new File([this.bytes], this.name); }
  async createWritable() { const chunks = []; return { write: async d => { chunks.push(d); }, close: async () => { this.bytes = new Uint8Array(await new Blob(chunks).arrayBuffer()); } }; }
}
const root = new Dir();
Object.defineProperty(globalThis, 'navigator', { value: { storage: { getDirectory: async () => root } }, configurable: true });
const store = await import('../src/scripts/pc/files/store.mjs');
const text = async (path, name) => (await (await store.read(path, name)).data.text());

test('countEntries counts a file as one entry and a folder with its contents', async () => {
  await store.write('', 'a.txt', 'A');
  await store.createFolder('', 'docs'); await store.write('docs', 'b.txt', 'B'); await store.createFolder('docs', 'sub');
  assert.equal(await store.countEntries('', 'a.txt'), 1);
  assert.equal(await store.countEntries('', 'docs'), 3);
});

test('rename refuses to overwrite an existing name and keeps both files', async () => {
  await store.write('', 'x.txt', 'X'); await store.write('', 'y.txt', 'Y');
  await assert.rejects(store.rename('', 'x.txt', 'y.txt'), /already exists/);
  assert.equal(await text('', 'x.txt'), 'X');
  assert.equal(await text('', 'y.txt'), 'Y');
  await store.rename('', 'x.txt', 'z.txt');
  assert.equal(await text('', 'z.txt'), 'X');
  assert.equal(await store.exists('', 'x.txt'), null);
});
