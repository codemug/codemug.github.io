// Unit tests for AI-2: Files tools — the path resolver (escapes, case, symlink-like names),
// text/binary detection, the 200 KB bound, tool gating/schemas, and that grants never enter
// a persisted conversation record. No OPFS, no DOM.
// Run: node --test tests/pc-ai-agent-files.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveInGrants, readText, looksBinary, writePreview, extension, MAX_READ_BYTES, MAX_WRITE_CHARS } from '../src/apps/ai-agent/file-tools.js';
import { createTools, toolSchemas } from '../src/apps/ai-agent/agent.js';
import { AgentSession, systemPrompt } from '../src/apps/ai-agent/session.js';
import { validateConversation } from '../src/apps/ai-agent/storage.js';

const G = [{ root: 'notes', kind: 'folder' }];
const err = (r) => r.error;

test('the resolver maps grant-relative paths to webpc-files paths', () => {
  assert.deepEqual(resolveInGrants(G, ''), { path: 'notes' }, 'empty path means the grant root');
  assert.deepEqual(resolveInGrants(G, 'a.txt'), { path: 'notes/a.txt' });
  assert.deepEqual(resolveInGrants(G, 'sub/b.txt'), { path: 'notes/sub/b.txt' });
  assert.deepEqual(resolveInGrants(G, './a.txt'), { path: 'notes/a.txt' });
  assert.deepEqual(resolveInGrants(G, 'a.txt/'), { path: 'notes/a.txt' });
  assert.deepEqual(resolveInGrants([{ root: '', kind: 'folder' }], 'x.md'), { path: 'x.md' }, 'a root grant covers the whole Files area');
  assert.deepEqual(resolveInGrants([{ root: 'notes/a.txt', kind: 'file' }], ''), { path: 'notes/a.txt' }, 'a file grant resolves only its own file');
  assert.ok(err(resolveInGrants([{ root: 'notes/a.txt', kind: 'file' }], 'b.txt')), 'a file grant does not cover other files');
  assert.ok(err(resolveInGrants([{ root: 'notes/a.txt', kind: 'file' }], '', { forWrite: true })), 'file grants never allow writes');
  assert.deepEqual(resolveInGrants([{ root: 'notes', kind: 'folder' }, { root: 'docs', kind: 'folder' }], 'x'), { path: 'notes/x' }, 'the first matching grant wins');
});

test('the resolver rejects escapes, absolute paths, backslashes, control chars and ..-style tricks', () => {
  for (const raw of ['..', '../x', 'a/../b', '../../etc', '..', '/etc/passwd', '\\etc', 'a\\b', 'a\u0000b', 'a\nb']) {
    assert.ok(err(resolveInGrants(G, raw)), `rejected: ${JSON.stringify(raw)}`);
    assert.ok(err(resolveInGrants(G, raw, { forWrite: true })), `write rejected: ${JSON.stringify(raw)}`);
  }
  // Case-sensitive: "Notes" is a new folder INSIDE the grant, not the grant root itself.
  assert.deepEqual(resolveInGrants([{ root: 'notes', kind: 'folder' }], 'Notes/x'), { path: 'notes/Notes/x' });
  // "..data" and "..." are names, not parents: allowed, and still inside the grant.
  assert.deepEqual(resolveInGrants(G, '..data'), { path: 'notes/..data' });
  assert.deepEqual(resolveInGrants(G, '...'), { path: 'notes/...' });
  assert.ok(err(resolveInGrants(G, undefined)), 'non-string input is rejected');
  assert.ok(err(resolveInGrants(G, 'a'.repeat(201))), 'overlong paths are rejected');
  assert.match(err(resolveInGrants([], 'x')), /Nothing yet|nothing yet/, 'no grants is a clear error');
});

test('readText: extensions, PDF pointer, the 200 KB bound, binary and invalid UTF-8', () => {
  assert.deepEqual(readText(new TextEncoder().encode('hello'), 'a.txt'), { text: 'hello', size: 5 });
  assert.match(err(readText(new Uint8Array(10), 'doc.pdf')), /PDFCraft/);
  assert.match(err(readText(new Uint8Array(10), 'a.bin')), /Unsupported file type/);
  assert.match(err(readText(new Uint8Array(MAX_READ_BYTES + 1), 'big.txt')), /at most 200 KB/);
  const nul = new Uint8Array([0x68, 0x69, 0x00, 0x21]); nul[2] = 0;
  assert.match(err(readText(nul, 'a.txt')), /binary/);
  assert.match(err(readText(new Uint8Array([0xff, 0xfe]), 'a.txt')), /not valid UTF-8/);
  const late = new Uint8Array(9000).fill(0x61); late[8500] = 0; // NUL past the first 8 KB is not a binary marker
  assert.equal(looksBinary(late), false);
  assert.deepEqual(extension('a.TXT'), 'txt'); assert.equal(extension('archive'), ''); assert.equal(extension('.hidden'), ''); assert.equal(extension('a.b.tar.gz'), 'gz');
});

test('writePreview names the path, size, first lines and says so on overwrite', () => {
  const fresh = writePreview('notes/c.txt', 'line one\nline two\nline three\nline four', false);
  assert.ok(fresh.includes('Write to "notes/c.txt"') && fresh.includes('38 bytes'), fresh);
  assert.ok(fresh.includes('line one') && fresh.includes('line three') && !fresh.includes('line four'), 'three first lines, no more');
  const over = writePreview('notes/a.txt', 'x', true);
  assert.ok(over.includes('OVERWRITES'), over);
});

test('the file tools are offered only with file hosts, with the right schemas and input bounds', async () => {
  const base = { webSearch: async () => ({ results: [] }), httpGet: async () => ({}), runJavaScript: async () => ({ result: 1 }), allowedHosts: () => new Set() };
  assert.deepEqual(Object.keys(createTools(base)).sort(), ['calculate', 'http_get', 'run_javascript', 'web_search'], 'no grants, no file tools');
  const hosts = { list: async () => ({ entries: [] }), read: async () => ({ text: 'x' }), write: async () => ({ result: 'ok' }) };
  const tools = createTools({ ...base, listFiles: hosts.list, readFile: hosts.read, writeFile: hosts.write });
  assert.deepEqual(Object.keys(tools).sort(), ['calculate', 'http_get', 'list_files', 'read_file', 'run_javascript', 'web_search', 'write_file']);
  const schemas = toolSchemas(tools);
  assert.deepEqual(schemas.find((s) => s.function.name === 'read_file').function.parameters.required, ['path']);
  assert.deepEqual(schemas.find((s) => s.function.name === 'write_file').function.parameters.required, ['path', 'content']);
  let got = null;
  const live = createTools({ ...base, listFiles: async (p) => { got = p; return { entries: [] }; }, readFile: async () => ({ text: 'x' }), writeFile: async (p, c) => ({ path: p, len: c.length }) });
  assert.deepEqual(await live.list_files.run({}), { entries: [] }, 'list_files with no path lists the grant root');
  assert.equal(got, '');
  assert.match(err((await live.write_file.run({ path: 'c.txt', content: 'a'.repeat(MAX_WRITE_CHARS + 1) }))), /too large/);
  assert.match(err((await live.write_file.run({ path: '  ', content: 'x' }))), /1 to 200/);
  assert.deepEqual(await live.write_file.run({ path: 'c.txt', content: 'x' }), { path: 'c.txt', len: 1 });
});

test('the system prompt mentions the grants (and nothing else changes)', () => {
  const plain = systemPrompt({ ready: true });
  assert.ok(plain.includes("You have no access to the computer's filesystem"));
  const granted = systemPrompt({ ready: true }, [{ root: 'notes', kind: 'folder' }]);
  assert.ok(!granted.includes('You have no access'), granted);
  assert.ok(granted.includes('list_files') && granted.includes('granted'), granted);
  assert.equal(systemPrompt({ host: 'api.anthropic.com' }), systemPrompt({ host: 'api.anthropic.com' }, null), 'a null/absent grant list keeps the no-access sentence');
});

test('the system prompt mentions the guest code runs only when run_code is offered', () => {
  assert.ok(systemPrompt({ ready: true }).includes("You have no access to the computer's filesystem"), 'default keeps the no-access sentence');
  const guest = systemPrompt({ ready: true }, null, true);
  assert.ok(!guest.includes('You have no access to the computer\'s filesystem or other desktop apps'), guest);
  assert.ok(guest.includes('run_code') && guest.includes('virtual machine'), guest);
  const both = systemPrompt({ ready: true }, [{ root: 'notes', kind: 'folder' }], true);
  assert.ok(both.includes('list_files') && both.includes('run_code'), 'grants and guest runs both apply');
});

test('the session offers the file tools while grants exist and keeps them out of the persisted record', async () => {
  const names = [];
  const client = { ready: true, count: () => Promise.resolve(1), stop: () => {}, generate: (messages, schemas) => { names.push(schemas.map((s) => s.function.name)); return 'Done.'; } };
  const saved = [];
  const session = new AgentSession({ client, store: { save: async (v) => { saved.push(v); } }, webSearch: async () => ({}), httpGet: async () => ({}), runJavaScript: async () => ({}), emit: () => {}, files: { grants: [{ root: 'notes', kind: 'folder' }], list: async () => ({ entries: [] }), read: async () => ({ text: 'a' }), write: async () => ({ result: 'ok' }) } });
  await session.send('read my notes');
  assert.ok(names[0].includes('list_files') && names[0].includes('read_file') && names[0].includes('write_file'), 'all three file tools are offered');
  assert.ok(session.prompt()[0].content.includes('granted'), 'the prompt tells the model about the grants');
  const snapshot = session.snapshot();
  assert.deepEqual(Object.keys(snapshot), ['history', 'summary'], 'the persisted snapshot cannot carry grants');
  const record = validateConversation(snapshot);
  assert.deepEqual(Object.keys(record).sort(), ['history', 'savedAt', 'summary', 'version'], 'the stored record shape has no grants field');
  assert.ok(!JSON.stringify(record).includes('"root"') && !JSON.stringify(record).includes('"kind":"folder"'), 'no grant data in the record');
  const bare = new AgentSession({ client, store: { save: async () => {} }, webSearch: async () => ({}), httpGet: async () => ({}), runJavaScript: async () => ({}), emit: () => {}, files: { grants: null } });
  await bare.send('hi');
  assert.ok(!names.at(-1).includes('list_files'), 'no grants → no file tools');
});
