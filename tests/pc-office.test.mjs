import test from 'node:test';
import assert from 'node:assert/strict';
import { encode, decode, documentBackup, readDocument } from '../scripts/pc/docs/storage.mjs';

test('Docs backups preserve OOXML Maps, bytes, and ArrayBuffers', () => {
  const document = { package: { document: { content: [{ type: 'paragraph', content: [] }] }, media: new Map([['image', new Uint8Array([0, 128, 255])]]) }, originalBuffer: new Uint8Array([80, 75]).buffer };
  const restored = readDocument(documentBackup('Draft', document));
  assert.equal(restored.name, 'Draft');
  assert.deepEqual(restored.document, document);
});
test('Docs rejects wrong-format, malformed and prototype-bearing backups', () => {
  assert.throws(() => readDocument('{}'));
  assert.throws(() => readDocument('{bad'));
  assert.throws(() => decode('{"__proto__":{}}'), /Unsupported/);
  assert.throws(() => decode('{"$webpc":"bytes","value":[999]}'), /Invalid/);
  assert.equal(decode(encode({ text: '<script>not executable</script>' })).text, '<script>not executable</script>');
});
