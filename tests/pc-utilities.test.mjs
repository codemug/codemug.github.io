import test from 'node:test';
import assert from 'node:assert/strict';
import { packCheckpoint, unpackCheckpoint, decompressBounded, MAX_FILE_BYTES } from '../src/scripts/pc/apps/linux-checkpoint.mjs';
const header = { version:1, imageId:'pinned-image', rawBytes:5, sha256:'a'.repeat(64), screen:'root# ', cols:80, rows:24 };
test('Linux checkpoint envelope preserves state bytes and rejects a different guest image', async () => {
 const file=packCheckpoint(header,new Blob(['bytes']));const parsed=await unpackCheckpoint(file,'pinned-image');assert.deepEqual(parsed.header,header);assert.equal(await parsed.payload.text(),'bytes');
 await assert.rejects(unpackCheckpoint(file,'new-image'),/different Linux image/);
});
test('Linux checkpoint importer rejects truncated and unreasonable envelope sizes', async () => {
 const file=packCheckpoint(header,new Blob(['bytes']));
 await assert.rejects(unpackCheckpoint(file.slice(0,20),'pinned-image'));
 await assert.rejects(unpackCheckpoint(new Blob(['legacy JSON']),'pinned-image'));
 assert.throws(()=>packCheckpoint({...header,rawBytes:NaN},new Blob(['x'])),/memory size/);
 assert.throws(()=>packCheckpoint({...header,cols:0},new Blob(['x'])),/dimensions/);
 const oversized=new Blob([new Uint8Array(MAX_FILE_BYTES+1)]);await assert.rejects(unpackCheckpoint(oversized,'pinned-image'),/exceeds/);
});
test('Linux gzip decoding verifies declared size and stops expansion beyond the bound', async () => {
 const payload=await new Response(new Blob(['hello']).stream().pipeThrough(new CompressionStream('gzip'))).blob();
 assert.equal(new TextDecoder().decode(await decompressBounded(payload,5)),'hello');
 await assert.rejects(decompressBounded(payload,4),/beyond/);
 await assert.rejects(decompressBounded(payload,6),/incomplete/);
 await assert.rejects(decompressBounded(new Blob(['corrupt']),5));
});
