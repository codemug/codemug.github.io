import test from 'node:test';
import assert from 'node:assert/strict';
import { staticApps, isUnsafeArchivePath, rowFingerprint } from '../scripts/pc/prepare-static-apps.mjs';

test('every static-apps table row is pinned', () => {
  assert.ok(staticApps.length > 0, 'table must not be empty');
  const ids = new Set();
  for (const app of staticApps) {
    assert.match(app.id, /^[a-z0-9][a-z0-9-]*$/, `${app.id} must be a safe vendor directory name`);
    assert.ok(!ids.has(app.id), `${app.id} appears twice`);
    ids.add(app.id);
    assert.match(app.version, /^[0-9][\w.+-]*$/, `${app.id} missing version`);
    assert.match(app.url, /^https:\/\//, `${app.id} must download over https`);
    assert.match(app.sha256, /^[0-9a-f]{64}$/, `${app.id} sha256 must be 64 lowercase hex chars`);
    assert.ok(typeof app.notice === 'string' && app.notice.length > 0, `${app.id} missing WEBPC.txt notice`);
    assert.ok(app.tweak == null || typeof app.tweak === 'function', `${app.id} tweak must be absent, null or a function`);
  }
});

test('unsafe archive paths are rejected, safe paths accepted', () => {
  for (const name of ['../x', '/abs', 'a\\b', 'a/../../b', 'a/../../../etc']) {
    assert.ok(isUnsafeArchivePath(name), `must reject: ${JSON.stringify(name)}`);
  }
  for (const name of ['index.html', 'assets/app.js', 'LICENSE', 'nested/dir/file.png']) {
    assert.ok(!isUnsafeArchivePath(name), `must accept: ${JSON.stringify(name)}`);
  }
});

test('rowFingerprint is deterministic and changes with preparer source or injected files', () => {
  const a = rowFingerprint('preparer source v1');
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.equal(rowFingerprint('preparer source v1'), a, 'must be deterministic');
  assert.notEqual(rowFingerprint('preparer source v2'), a, 'a preparer change must force re-preparation');
  const withFile = rowFingerprint('preparer source v1', ['audio guard v1']);
  assert.notEqual(withFile, a, 'an injected file must be part of the fingerprint');
  assert.equal(rowFingerprint('preparer source v1', ['audio guard v1']), withFile, 'must be deterministic');
  assert.notEqual(rowFingerprint('preparer source v1', ['audio guard v2']), withFile, 'an injected-file change must force re-preparation');
});
