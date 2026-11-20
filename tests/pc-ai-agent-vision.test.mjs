// Unit tests for AI-7/AI-8 Part A: the pure vision helpers (validation, result shaping,
// downscale plan, engine metadata, tool schemas) and that neither new module touches browser
// storage APIs. vision-worker.js is asserted on as text (it imports the browser bundle,
// so it is not imported here). agent.js/session.js are the AI-4 lane's and are not imported.
// Run: node --test tests/pc-ai-agent-vision.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  validateImageFile, ocrTextResult, nobgName, nobgTarget, downscalePlan, BGBM_ENGINES,
  VISION_TOOL_SCHEMAS, MAX_IMAGE_BYTES, OCR_MAX_TEXT, visionToolsEnabled,
} from '../src/apps/ai-agent/vision-tools.js';

test('validateImageFile accepts png/jpeg/webp and the 10 MB boundary', () => {
  for (const type of ['image/png', 'image/jpeg', 'image/webp']) {
    assert.equal(validateImageFile({ name: 'a', type, size: 100 }), '', `accepts ${type}`);
  }
  assert.equal(validateImageFile({ name: 'a', type: 'image/png', size: MAX_IMAGE_BYTES }), '', 'exactly 10 MB is allowed');
  assert.match(validateImageFile({ name: 'a', type: 'image/png', size: MAX_IMAGE_BYTES + 1 }), /too large/);
});

test('validateImageFile rejects other types, and falls back to the extension without a type', () => {
  assert.match(validateImageFile({ name: 'a', type: 'image/gif', size: 10 }), /Only PNG/);
  assert.match(validateImageFile({ name: 'a', type: 'text/plain', size: 10 }), /Only PNG/);
  assert.equal(validateImageFile({ name: 'photo.JPG', type: '', size: 10 }), '', 'extension fallback, case-insensitive');
  assert.match(validateImageFile({ name: 'photo.gif', type: '', size: 10 }), /Only PNG/);
  assert.equal(validateImageFile({}), 'Only PNG, JPEG and WebP images are supported.', 'nothing given is rejected');
});

test('ocrTextResult passes short text through and truncates at 20 KB with a marker', () => {
  assert.equal(ocrTextResult('hello'), 'hello');
  assert.equal(ocrTextResult(null), '');
  const exact = 'x'.repeat(OCR_MAX_TEXT);
  assert.equal(ocrTextResult(exact), exact, 'exactly the bound is not truncated');
  const long = 'y'.repeat(OCR_MAX_TEXT + 5000);
  const out = ocrTextResult(long);
  assert.ok(out.startsWith('y'.repeat(1000)));
  assert.ok(out.endsWith('…[truncated]'));
  assert.ok(out.length < long.length);
});

test('nobgName puts <name>-nobg.png next to the source, stripping only a real file extension', () => {
  assert.equal(nobgName('photos/cat.jpg'), 'photos/cat-nobg.png');
  assert.equal(nobgName('cat.png'), 'cat-nobg.png');
  assert.equal(nobgName('cat'), 'cat-nobg.png');
  assert.equal(nobgName(''), '-nobg.png');
  assert.equal(nobgName('docs/scan'), 'docs/scan-nobg.png');
});

test('downscalePlan shrinks to the bound, preserves aspect, never upscales', () => {
  assert.deepEqual(downscalePlan(1536, 768), { width: 768, height: 384 });
  assert.deepEqual(downscalePlan(768, 1000), { width: 590, height: 768 });
  assert.deepEqual(downscalePlan(100, 100), { width: 100, height: 100 }, 'no upscale');
  assert.deepEqual(downscalePlan(1, 1), { width: 1, height: 1 }, 'one pixel stays one pixel');
  const wide = downscalePlan(3000, 10);
  assert.ok(wide.width <= 768 && wide.height <= 768 && wide.width >= 1 && wide.height >= 1);
  assert.deepEqual(downscalePlan(1536, 768, 384), { width: 384, height: 192 }, 'custom max dim');
});

test('the bg-removal engine list offers MODNet by default and BiRefNet Lite as the WebGPU-only quality option', () => {
  assert.equal(BGBM_ENGINES[0].id, 'modnet');
  assert.equal(BGBM_ENGINES[1].id, 'birefnet');
  assert.ok(BGBM_ENGINES[1].webgpuOnly, 'BiRefNet Lite is WebGPU-only');
  assert.ok(BGBM_ENGINES[0].sizeMB < BGBM_ENGINES[1].sizeMB, 'MODNet is the small default');
  assert.match(BGBM_ENGINES[0].note, /people and portraits/, 'MODNet copy says best for people and portraits');
  assert.match(BGBM_ENGINES[1].note, /general objects/i, 'BiRefNet Lite copy says general objects');
});

test('the tool schemas require a source string for both tools', () => {
  for (const name of ['ocr_image', 'remove_background']) {
    const s = VISION_TOOL_SCHEMAS[name];
    assert.deepEqual(s.parameters.required, ['source'], `${name} requires source`);
    assert.equal(s.parameters.properties.source.type, 'string');
    assert.match(s.description, /attached/);
  }
  assert.equal(Object.keys(VISION_TOOL_SCHEMAS).length, 2);
});

test('visionToolsEnabled gates the tools on an available image source (Part B)', () => {
  const grants = [{ root: 'photos', kind: 'folder' }];
  assert.equal(visionToolsEnabled({ grants, imageInput: false }), true, 'a grant offers a source');
  assert.equal(visionToolsEnabled({ grants: [], imageInput: true }), true, 'an attachable image offers a source');
  assert.equal(visionToolsEnabled({ grants, imageInput: true }), true, 'both at once');
  assert.equal(visionToolsEnabled({ grants: [], imageInput: false }), false, 'no grant and no attachable image: hidden');
  assert.equal(visionToolsEnabled({ imageInput: true }), true, 'undefined grants are not an error');
  assert.equal(visionToolsEnabled({}), false, 'nothing given: hidden');
});

test('neither vision module touches browser storage APIs', () => {
  for (const file of ['src/apps/ai-agent/vision-tools.js', 'src/apps/ai-agent/vision-worker.js']) {
    const src = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.ok(!/indexedDB|opfs|navigator\.storage|localStorage|sessionStorage/i.test(src), `${file} must not use storage APIs`);
  }
});

test('remove_background save target needs a covering folder grant before the save gate (review 10)', () => {
  assert.deepEqual(nobgTarget([{ root: 'notes', kind: 'folder' }], 'notes/cat.jpg'), { target: 'notes/cat-nobg.png' }, 'a folder grant covers the target');
  const fileOnly = nobgTarget([{ root: 'notes/cat.jpg', kind: 'file' }], 'notes/cat.jpg');
  assert.match(fileOnly.error, /granted folder/i, 'a read-only file grant on the source is not enough');
  const noGrants = nobgTarget([], 'notes/cat.jpg');
  assert.match(noGrants.error, /grant/i, 'no grants at all is a clear error');
  const nested = nobgTarget([{ root: 'photos/2024', kind: 'folder' }], 'photos/2024/cat.jpg');
  assert.deepEqual(nested, { target: 'photos/2024/cat-nobg.png' }, 'nested folder grants work at the full path');
});

test('Florence has no fp32 fall-back and a failed load is not cached (review 18)', () => {
  const src = readFileSync(new URL('../src/apps/ai-agent/vision-worker.js', import.meta.url), 'utf8');
  assert.ok(!src.includes("['wasm', 'q8'], ['wasm', 'fp32']"), 'no q8→fp32 plan pair (the 1.09 GB download is gone)');
  assert.match(src, /\[\['wasm', 'q8'\]\]/, 'Florence loads a single wasm/q8 plan');
  assert.match(src, /catch\(\(err\) => \{ delete state\[key\]; throw err; \}\)/, 'a failed load is removed from the cache, so the next request retries');
});
