// Unit tests for AI-3: the Files search index — chunker (boundaries, overlap, empty/tiny),
// cosine top-k (ties, k bounds), skip-unchanged, revoke dropping chunks, the 5 MB cap,
// result shaping, and that nothing is persisted. No OPFS, no DOM.
// Run: node --test tests/pc-ai-agent-search.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chunkText, cosineTopK, fileChanged, overCharBudget, searchResults, SearchIndex, CHUNK_SIZE, CHUNK_OVERLAP, MAX_INDEX_CHARS, SNIPPET_CHARS } from '../src/apps/ai-agent/search-index.js';
import { createTools, toolSchemas } from '../src/apps/ai-agent/agent.js';

test('chunkText: empty and tiny files', () => {
  assert.deepEqual(chunkText(''), []);
  assert.deepEqual(chunkText(undefined), []);
  assert.deepEqual(chunkText('hello'), [{ text: 'hello', offset: 0 }]);
});

test('chunkText: a long single line hard-breaks with exactly the overlap', () => {
  const text = 'a'.repeat(2000);
  const chunks = chunkText(text);
  assert.deepEqual(chunks.map((c) => c.offset), [0, 700, 1400], 'three chunks stepping by size-overlap');
  assert.ok(chunks.every((c) => c.text.length <= CHUNK_SIZE));
  assert.equal(chunks[0].text.length, CHUNK_SIZE);
  assert.equal(chunks[1].offset + CHUNK_SIZE, 1500);
  assert.equal(chunks[2].text.length, 600, 'the last chunk ends at the text end');
  // The shared tail: the first chunk's last 100 chars equal the second chunk's first 100.
  assert.equal(chunks[0].text.slice(-CHUNK_OVERLAP), chunks[1].text.slice(0, CHUNK_OVERLAP));
});

test('chunkText: paragraph breaks are preferred, then line breaks', () => {
  const para = (n) => `paragraph ${n} ${'word '.repeat(40).trim()}\n\n`; // ~180 chars each
  const text = para(1) + para(2) + para(3) + para(4); // ~730 chars, fits one window
  const chunks = chunkText(text);
  assert.equal(chunks.length, 2, 'the paragraph break near the window end wins over a hard cut');
  assert.ok(chunks[0].text.endsWith('\n'), 'the chunk ends on the paragraph break');
  assert.equal(chunks[1].offset, chunks[0].offset + chunks[0].text.length - CHUNK_OVERLAP, 'the next chunk starts exactly the overlap before the previous end');
  assert.ok(chunks[1].text.includes('paragraph 4'), 'the rest of the document is still covered');
  // Lines: a window with only single newlines breaks on one.
  const lines = Array.from({ length: 90 }, (_, i) => `line ${i} ${'x'.repeat(20)}`).join('\n'); // ~2000 chars
  const lineChunks = chunkText(lines);
  assert.ok(lineChunks.length > 1 && lineChunks.slice(0, -1).every((c) => c.text.endsWith('\n')), 'non-final chunks end on a line break');
  assert.ok(lineChunks.every((c) => c.text.length <= CHUNK_SIZE));
  // Offsets always move forward.
  const offsets = lineChunks.map((c) => c.offset);
  assert.deepEqual(offsets, [...offsets].sort((a, b) => a - b));
});

test('cosineTopK: ranking, ties keep the earlier index, k clamps to 1..n', () => {
  const vectors = [
    new Float32Array([1, 0]),
    new Float32Array([0.5, 0.5]),
    new Float32Array([0, 1]),
  ];
  assert.deepEqual(cosineTopK(vectors, new Float32Array([1, 0]), 2), [0, 1]);
  assert.deepEqual(cosineTopK(vectors, new Float32Array([1, 0]), 99), [0, 1, 2], 'k above n returns everything');
  assert.deepEqual(cosineTopK(vectors, new Float32Array([1, 0]), 0), [0, 1, 2], 'k=0 falls back to the default (5), clamped to n');
  assert.deepEqual(cosineTopK([], new Float32Array([1]), 3), []);
  // Exact tie: two identical top vectors, the earlier index ranks first.
  const tied = [new Float32Array([1, 0]), new Float32Array([1, 0]), new Float32Array([0, 1])];
  assert.deepEqual(cosineTopK(tied, new Float32Array([1, 0]), 2), [0, 1]);
});

test('fileChanged and overCharBudget drive the skip-unchanged logic', () => {
  assert.ok(fileChanged(null, { size: 1, mtime: 2 }));
  assert.ok(!fileChanged({ size: 1, mtime: 2 }, { size: 1, mtime: 2 }));
  assert.ok(fileChanged({ size: 1, mtime: 2 }, { size: 9, mtime: 2 }), 'size moved');
  assert.ok(fileChanged({ size: 1, mtime: 2 }, { size: 1, mtime: 3 }), 'mtime moved');
  assert.ok(!overCharBudget(100, 5, MAX_INDEX_CHARS));
  assert.ok(overCharBudget(MAX_INDEX_CHARS - 4, 5, MAX_INDEX_CHARS));
  assert.ok(overCharBudget(0, MAX_INDEX_CHARS + 1, MAX_INDEX_CHARS));
});

test('SearchIndex: revoke drops exactly one grant, stats and clear', () => {
  const idx = new SearchIndex();
  const v = () => new Float32Array([1]);
  idx.upsert('notes/a.txt', { size: 1, mtime: 1 }, [{ text: 'a', offset: 0, vector: v() }]);
  idx.upsert('notes/deep/b.txt', { size: 2, mtime: 2 }, [{ text: 'b', offset: 0, vector: v() }]);
  idx.upsert('docs/c.txt', { size: 3, mtime: 3 }, [{ text: 'c', offset: 0, vector: v() }]);
  assert.ok(idx.has());
  idx.revoke('notes', 'folder');
  assert.deepEqual([...idx.files.keys()], ['docs/c.txt'], 'the folder grant drops its root subtree only');
  idx.revoke('docs/c.txt', 'file');
  assert.equal(idx.has(), false, 'a file grant drops exactly that path');
  idx.upsert('x.txt', { size: 1, mtime: 1 }, []);
  assert.equal(idx.has(), false, 'empty chunks do not count as an index');
  idx.upsert('y.txt', { size: 1, mtime: 1 }, [{ text: 'y', offset: 0, vector: v() }]);
  idx.revoke('', 'folder');
  assert.equal(idx.has(), false, 'a root folder grant revokes everything');
  idx.upsert('z.txt', { size: 1, mtime: 1 }, [{ text: 'zz', offset: 0, vector: v() }]);
  assert.deepEqual(idx.stats(), { files: 1, chunks: 1, chars: 2 });
  idx.clear();
  assert.equal(idx.files.size, 0);
});

test('searchResults: score to 2 decimals, snippet bounded, paths kept', () => {
  const entries = [
    { path: 'a.txt', text: 'alpha ' + 'z'.repeat(500), vector: new Float32Array([1, 0]) },
    { path: 'b.txt', text: 'beta', vector: new Float32Array([0.9, 0.1]) },
  ];
  const results = searchResults(entries, new Float32Array([1, 0]), 2);
  assert.deepEqual(results.map((r) => r.path), ['a.txt', 'b.txt']);
  assert.equal(results[0].score, 1);
  assert.equal(results[1].score, 0.9, '0.9000… rounds to 2 decimals');
  assert.equal(results[0].snippet.length, SNIPPET_CHARS, 'the snippet is cut to the bound');
  assert.ok(results[0].snippet.startsWith('alpha'));
});

test('the search_files tool: gating, schema and k bounds', async () => {
  const base = { webSearch: async () => ({ results: [] }), httpGet: async () => ({}), runJavaScript: async () => ({ result: 1 }), allowedHosts: () => new Set() };
  assert.ok(!createTools(base).search_files, 'no index host, no search tool');
  let got = null;
  const tools = createTools({ ...base, searchFiles: async (q, k) => { got = [q, k]; return [{ path: 'a.txt', score: 1, snippet: 'a' }]; } });
  const schema = toolSchemas(tools).find((s) => s.function.name === 'search_files');
  assert.deepEqual(schema.function.parameters.required, ['query']);
  assert.deepEqual(await tools.search_files.run({ query: 'coffee' }), [{ path: 'a.txt', score: 1, snippet: 'a' }]);
  assert.deepEqual(got, ['coffee', 5], 'k defaults to 5');
  assert.deepEqual(await tools.search_files.run({ query: 'coffee', k: 10 }), [{ path: 'a.txt', score: 1, snippet: 'a' }]);
  assert.match((await tools.search_files.run({ query: 'x', k: 0 })).error, /integer from 1 to 10/);
  assert.match((await tools.search_files.run({ query: 'x', k: 11 })).error, /integer from 1 to 10/);
  assert.match((await tools.search_files.run({ query: 'x', k: 2.5 })).error, /integer from 1 to 10/);
  assert.match((await tools.search_files.run({ query: '  ' })).error, /1 to 200 characters/);
});

test('the index logic is memory only: no storage APIs in the pure modules', () => {
  const here = (f) => readFileSync(fileURLToPath(new URL(`../src/apps/ai-agent/${f}`, import.meta.url)), 'utf8');
  for (const file of ['search-index.js', 'search-host.js']) {
    const src = here(file);
    assert.ok(!/localStorage|sessionStorage|indexedDB|openDatabase/.test(src), `${file} must not persist`);
  }
  assert.ok(/BroadcastChannel/.test(here('search-host.js')), 'the host listens on the Files refresh channel');
});

test('dispose() no longer kills the Files refresh channel for good (review 13)', () => {
  const src = readFileSync(fileURLToPath(new URL('../src/apps/ai-agent/search-host.js', import.meta.url)), 'utf8');
  assert.match(src, /let channel = null;/, 'the channel is mutable (recreatable), not a one-shot const');
  assert.match(src, /const ensureChannel = \(\) => \{\s*if \(channel\) return;/, 'a lazy re-creator exists');
  const body = src.slice(src.indexOf('async function indexFiles'), src.indexOf('async function refresh'));
  assert.ok(body.includes('ensureChannel()'), 'indexFiles re-creates the channel before walking, so auto-refresh survives a New chat');
  assert.match(src.slice(src.indexOf('const dispose')), /channel\?\.close\(\);\s*channel = null;/, 'dispose closes AND nulls the channel');
});
