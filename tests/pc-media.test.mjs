import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlaylist, addItems, nextIndex, prevIndex, advance, removeAt, mediaKind, isMedia} from '../src/scripts/pc/media/playlist.mjs';

const three = () => { const p = createPlaylist(); addItems(p, [{ name: 'a' }, { name: 'b' }, { name: 'c' }]); return p; };

test('next advances, previous wraps, next stays on the last with repeat off', () => {
  const p = three();
  assert.equal(nextIndex(p), 1);
  assert.equal(prevIndex(p), 2); // previous wraps to the end
  p.index = 2;
  assert.equal(nextIndex(p), 2); // repeat off: stay on the last
  p.repeat = 'all';
  assert.equal(nextIndex(p), 0); // repeat all: wrap
});

test('advance honours repeat modes', () => {
  const p = three();
  p.index = 1;
  assert.equal(advance(p), 2); // off: forward
  p.repeat = 'all'; p.index = 2;
  assert.equal(advance(p), 0); // all: wrap on end
  p.repeat = 'one';
  assert.equal(advance(p), 2); // one: replay the same item
  p.repeat = 'off'; p.index = 2;
  assert.equal(advance(p), 2); // off: end on the last
});

test('removing items keeps the current index sensible', () => {
  const p = three();
  removeAt(p, 0); // remove earlier: b slides to index 0
  assert.deepEqual(p.items.map(i => i.name), ['b', 'c']);
  assert.equal(p.index, 0);
  removeAt(p, 1); // remove later: index unchanged
  assert.equal(p.index, 0);
  const q = three();
  q.index = 1;
  removeAt(q, 1); // remove current: next item (c) takes over
  assert.equal(q.index, 1);
  assert.equal(q.items[q.index].name, 'c');
  removeAt(q, 0); // remove the item before the current: c slides to index 0
  assert.equal(q.index, 0);
  assert.equal(q.items[q.index].name, 'c');
  removeAt(q, 0); // remove the last remaining (current) item
  assert.equal(q.index, -1);
  assert.equal(nextIndex(q), -1);
});

test('mediaKind prefers MIME, falls back to the extension', () => {
  assert.equal(mediaKind('x.bin', 'audio/mpeg'), 'audio');
  assert.equal(mediaKind('x.bin', 'video/mp4'), 'video');
  assert.equal(mediaKind('song.mp3'), 'audio');
  assert.equal(mediaKind('clip.MP4'), 'video');
  assert.equal(mediaKind('notes.txt'), null);
  assert.equal(mediaKind('x.mp3', 'application/pdf'), 'audio'); // odd MIME: name wins
  assert.ok(isMedia('a.flac') && isMedia('a.webm') && !isMedia('a.docx'));
});

test('mediaKind needs a real extension, not a name ending in one', () => {
  assert.equal(mediaKind('remov', ''), null);
  assert.equal(mediaKind('notes.txt-mp3', ''), null);
  assert.equal(mediaKind('song.MP3', ''), 'audio');
  assert.equal(mediaKind('clip.webm', ''), 'video');
});
