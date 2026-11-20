import test from 'node:test';
import assert from 'node:assert/strict';
import {parseAccept, matchesAccept, visibleInPicker} from '../src/scripts/pc/files/picker.mjs';

test('parseAccept splits extension groups and MIME types', () => {
  const {exts, mimes} = parseAccept(' .pdf , .PNG , audio/*, video/mp4 ');
  assert.deepEqual([...exts].sort(), ['pdf', 'png']);
  assert.deepEqual(mimes, ['audio/*', 'video/mp4']);
  assert.deepEqual(parseAccept(''), { exts: new Set(), mimes: [] });
  assert.deepEqual(parseAccept(undefined), { exts: new Set(), mimes: [] });
});

test('typeless files (all OPFS files) match by extension only', () => {
  assert.ok(matchesAccept('.pdf', 'doc.PDF'));
  assert.ok(matchesAccept('.pdf,.png', 'photo.PNG'));
  assert.ok(!matchesAccept('.pdf', 'notes.txt'));
  assert.ok(!matchesAccept('.pdf', 'noextension'));
  assert.ok(!matchesAccept('.pdf', '.hidden')); // a leading dot is not an extension
  assert.ok(matchesAccept('', 'anything.bin')); // empty accept: everything
});

test('MIME groups match with and without wildcards', () => {
  assert.ok(matchesAccept('audio/*', 'a', 'audio/mpeg'));
  assert.ok(matchesAccept('audio/*', 'a', 'audio/wav'));
  assert.ok(!matchesAccept('audio/*', 'a', 'video/mp4'));
  assert.ok(matchesAccept('video/mp4', 'v', 'video/mp4'));
  assert.ok(!matchesAccept('video/mp4', 'v', 'video/quicktime'));
  assert.ok(matchesAccept('*/*', 'x')); // wildcard matches typeless files too
  assert.ok(matchesAccept('*/*', 'x', 'application/octet-stream'));
});

test('a known type matches only its MIME groups, not extensions', () => {
  assert.ok(!matchesAccept('.txt', 'x.txt', 'application/pdf'));
  assert.ok(!matchesAccept('audio/*', 'x.mp3', 'text/plain'));
  assert.ok(matchesAccept('audio/*,.mp3', 'x.mp3', 'audio/mpeg'));
  assert.ok(matchesAccept('audio/*,.mp3', 'x.mp3', '')); // extension still works when typeless
});

test('the media accept list keeps audio and video, drops the rest', () => {
  const spec = 'audio/*,video/*';
  assert.ok(matchesAccept(spec, 'a.wav'));
  assert.ok(matchesAccept(spec, 'b.mp4'));
  assert.ok(!matchesAccept(spec, 'c.pdf'));
  assert.ok(!matchesAccept(spec, 'd.txt'));
});

test('select mode controls which rows are visible; the default keeps the old file-pick behaviour', () => {
  const folder = { name: 'notes', kind: 'folder' };
  const file = { name: 'a.txt', kind: 'file' };
  assert.ok(visibleInPicker('file', '', folder));
  assert.ok(visibleInPicker('file', '', file));
  assert.ok(!visibleInPicker('file', '.pdf', file), 'the accept filter still applies in file mode');
  assert.ok(visibleInPicker(undefined, '.txt', file), 'the default select is file');
  assert.ok(visibleInPicker('folder', '', folder));
  assert.ok(!visibleInPicker('folder', '', file), 'folder mode hides files');
  assert.ok(visibleInPicker('any', '', folder));
  assert.ok(visibleInPicker('any', '', file), 'any mode shows both (AI-2 grants)');
});
