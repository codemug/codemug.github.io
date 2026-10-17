import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Part 1's running example moved from gemma-3-4b to Qwen3.8-27B; Part 2 refers back to it.
const p2 = readFileSync('src/content/blog/sre-guide-deploying-llms-part-2.mdx', 'utf8');
const fig = readFileSync('src/components/illustrations/anim/Fig.astro', 'utf8');

test('Part 2 no longer refers to gemma-specific details', () => {
  for (const s of ['<start_of_turn>', '<end_of_turn>', 'gemma-style', '2560 by 8', 'ten thousand independent', 'You are Qwen, created by Alibaba Cloud', 'a ReLU']) {
    assert.ok(!p2.includes(s), s);
  }
});

test('Part 2 uses Qwen3.8-27B details', () => {
  for (const s of ['<|im_start|>assistant', 'Reasoning effort is set to xhigh', '`5120 by 8`', 'seventeen thousand independent', '`reasoning_effort`', '`enable_thinking`']) {
    assert.ok(p2.includes(s), s);
  }
});

test('Part 2 keeps the style contract (no em/en dashes, no curly quotes)', () => {
  assert.ok(!/[—–‘’“”]/.test(p2));
});

test('chat-template figure shows Qwen turn markers', () => {
  assert.ok(!fig.includes('start_of_turn') && !fig.includes('end_of_turn'));
  assert.ok(fig.includes('&lt;|im_start|&gt;assistant'));
  assert.ok(fig.includes('no assistant cue'));
});
