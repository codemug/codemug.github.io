import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const fig = readFileSync('src/components/illustrations/anim/Fig.astro', 'utf8');
const anim = readFileSync('src/components/illustrations/anim/AnimRuntime.astro', 'utf8');

const REMOVED_NAMES = [
  'tokenize', 'config', 'tokenloop', 'embeddings', 'training', 'attention', 'ffn', 'ffn-matrix',
  'ffn-relu', 'ffn-detector', 'nextword', 'temperature', 'whyattention', 'whyffn', 'forward', 'trainpass',
  'sft-base-vs-instruct', 'chat-template', 'rl-loop', 'rl-reward-source', 'dpo-chosen-rejected', 'cpu-vs-gpu', 'matmul-parallel', 'tensor-core',
  'kernel-tiling', 'kv-cache', 'why-cache-kv', 'prefill-decode', 'bit-drop', 'moe-routing', 'moe-dense'
];

const KEPT_NAMES = [
  'primer-vram', 'primer-dilution', 'primer-split', 'primer-toolsearch', 'primer-surface',
  'primer-workspace', 'primer-loop', 'primer-events', 'primer-approval', 'primer-harness',
  'hw-three-levers', 'mem-bandwidth-ladder', 'interconnect', 'dedicated-vs-unified', 'apple-soc',
  'radix-attention', 'paged-attention', 'mesh', 'engine-scorecard', 'vendor-scorecard'
];

const REMOVED_CLASSES = [
  'tok', 'cfg', 'loop', 'emb', 'trn', 'attn', 'ffn', 'fmx',
  'frl', 'fdet', 'nw', 'temp', 'wa', 'wf', 'fwd', 'tp',
  'p2sft', 'p2tmpl', 'p2rl', 'p2rew', 'p2dpo', 'p2cg', 'p2mm', 'p2tc',
  'p2kt', 'p2kv', 'p2wc', 'p2pd', 'p2bit', 'moer', 'moed'
];

test('none of the 31 removed figures appears in Fig.astro', () => {
  for (const name of REMOVED_NAMES) {
    assert.ok(!fig.includes(`name === "${name}"`), `Fig.astro must not contain figure "${name}"`);
  }
});

test('all 20 kept figures appear in Fig.astro', () => {
  for (const name of KEPT_NAMES) {
    assert.ok(fig.includes(`name === "${name}"`), `Fig.astro must contain figure "${name}"`);
  }
});

test('no selector in AnimRuntime.astro has a removed root class as its first class', () => {
  const styleMatch = anim.match(/<style[^>]*>([\s\S]*?)<\/style>/);
  assert.ok(styleMatch, 'AnimRuntime.astro must have a <style> block');
  const css = styleMatch[1];
  for (const cls of REMOVED_CLASSES) {
    const pattern = new RegExp(`(^|[{},;])\\s*\\.${cls}\\b`);
    assert.ok(!pattern.test(css), `AnimRuntime.astro style must not have selector rooted at .${cls}`);
  }
});

test('the FramePlayer shell and shared rules remain in AnimRuntime.astro', () => {
  assert.ok(anim.includes('.fp{'), 'shell .fp{ must be present');
  assert.ok(anim.includes('.ill'), 'shared .ill rules must be present');
});
