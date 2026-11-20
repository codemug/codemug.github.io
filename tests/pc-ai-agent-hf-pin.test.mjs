// Unit tests for the shared Hugging Face URL-pinning helper (hf-pin.js). The module patches
// globalThis.fetch on import (guarded side effect, so the test process is unaffected in any
// observable way); these tests exercise the pure `pinnedUrl` rewrite.
// Run: node --test tests/pc-ai-agent-hf-pin.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pinnedUrl, HF_PINNED } from '../src/apps/ai-agent/hf-pin.js';

test('pinnedUrl rewrites /resolve/main/ to the pinned revision for every pinned repo', () => {
  assert.ok(Object.keys(HF_PINNED).length >= 7, 'the map covers the vision, embedding and chat repos');
  for (const [repo, sha] of Object.entries(HF_PINNED)) {
    const url = `https://huggingface.co/${repo}/resolve/main/tokenizer_config.json`;
    assert.equal(pinnedUrl(url), `https://huggingface.co/${repo}/resolve/${sha}/tokenizer_config.json`, repo);
  }
});

test('pinnedUrl rewrites the resolve-cache API form and keeps the query string', () => {
  const [repo, sha] = Object.entries(HF_PINNED)[0];
  const url = `https://huggingface.co/api/resolve-cache/models/${repo}/main/config.json?etag=abc`;
  assert.equal(pinnedUrl(url), `https://huggingface.co/api/resolve-cache/models/${repo}/${sha}/config.json?etag=abc`);
});

test('pinnedUrl passes everything else through untouched', () => {
  const [repo, sha] = Object.entries(HF_PINNED)[0];
  assert.equal(pinnedUrl(`https://huggingface.co/${repo}/resolve/${sha}/config.json`), `https://huggingface.co/${repo}/resolve/${sha}/config.json`, 'a pinned-revision URL is left alone');
  assert.equal(pinnedUrl('https://huggingface.co/some/other-repo/resolve/main/model.onnx'), 'https://huggingface.co/some/other-repo/resolve/main/model.onnx', 'an unpinned repo passes through');
  assert.equal(pinnedUrl('http://localhost:4322/pc/'), 'http://localhost:4322/pc/', 'non-HF URLs pass through');
  const req = { url: `https://huggingface.co/${repo}/resolve/main/x.json` };
  assert.equal(pinnedUrl(req), req, 'non-string input passes through');
});
