import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Part 1's running example moved from gemma-3-4b to Qwen3.8-27B; Part 2 refers back to it.
const p2 = () => readFileSync('src/content/blog/sre-guide-deploying-llms-part-2.mdx', 'utf8');
const p1 = readFileSync('src/content/blog/sre-guide-deploying-llms-part-1.mdx', 'utf8');
const figures = Object.keys(JSON.parse(readFileSync('src/components/illustrations/deck/figures.json', 'utf8')));
const t105 = readFileSync('src/components/illustrations/deck/slides/t105-control-tokens.html', 'utf8');

export function section(heading) {
  const mdx = readFileSync('src/content/blog/sre-guide-deploying-llms-part-2.mdx', 'utf8');
  if (!heading || heading === 'Opening') {
    const afterFm = mdx.replace(/^---[\s\S]*?---\s*/, '');
    const firstH2 = afterFm.indexOf('\n## ');
    return firstH2 === -1 ? afterFm : afterFm.slice(0, firstH2);
  }
  const needle = `\n## ${heading}\n`;
  const idx = mdx.indexOf(needle);
  if (idx === -1) throw new Error(`Section "## ${heading}" not found`);
  const start = idx + needle.length;
  const nextIdx = mdx.indexOf('\n## ', start);
  return nextIdx === -1 ? mdx.slice(start) : mdx.slice(start, nextIdx);
}

export function order(text, names) {
  let lastIndex = -1;
  for (const name of names) {
    const pattern = new RegExp(`<DeckFig\\s+name=["']${name}["']\\s*/>`, 'g');
    const matches = [...text.matchAll(pattern)];
    assert.equal(matches.length, 1, `Expected <DeckFig name="${name}" /> once, found ${matches.length}`);
    const index = matches[0].index;
    assert.ok(index > lastIndex, `Expected <DeckFig name="${name}" /> to follow previous figure in order`);
    lastIndex = index;
  }
}

test('Part 2 no longer refers to gemma-specific details', () => {
  const text = p2();
  for (const s of ['<start_of_turn>', '<end_of_turn>', 'gemma-style', '2560 by 8', 'ten thousand independent', 'You are Qwen, created by Alibaba Cloud', 'a ReLU']) {
    assert.ok(!text.includes(s), s);
  }
});

test('Part 2 uses Qwen3.8-27B details', () => {
  const text = p2();
  for (const s of ['<|im_start|>assistant', 'Reasoning effort is set to xhigh', 'seventeen thousand independent', '`reasoning_effort`', '`enable_thinking`']) {
    assert.ok(text.includes(s), s);
  }
});

test('Part 2 keeps the style contract (no em/en dashes, no curly quotes)', () => {
  assert.ok(!/[—–‘’“”]/.test(p2()));
});

test('Task 5: Opening figures appear in order', () => {
  order(section('Opening'), ['p2-left-off', 'p2-two-threads']);
});

test('Task 5: Fine tuning figures appear in order', () => {
  order(section('Fine tuning'), [
    'p2-base-continues',
    'p2-sft',
    'p2-dolly',
    'p2-chat-template',
    'p2-template-knobs',
    'p2-tool-calling',
  ]);
});

test('Task 5: Fine tuning must-have strings are present and retired figures are absent', () => {
  const ft = section('Fine tuning');
  assert.ok(ft.includes('add_generation_prompt'), 'must have add_generation_prompt');
  assert.ok(ft.includes('15,011'), 'must have 15,011');
  assert.ok(ft.includes('<tool_call>'), 'must have <tool_call>');
  assert.ok(!ft.includes('<Fig name="sft-base-vs-instruct"'), 'must not have sft-base-vs-instruct');
  assert.ok(!ft.includes('<Fig name="chat-template"'), 'must not have chat-template');

  const reIdx = ft.lastIndexOf('reasoning_effort');
  const tcLinkIdx = ft.indexOf('tool calling series');
  assert.ok(reIdx !== -1, 'reasoning_effort must be present');
  assert.ok(tcLinkIdx !== -1, 'link to tool calling series must be present');
  assert.ok(tcLinkIdx > reIdx, 'link to tool calling series must be placed after reasoning_effort');
});

test('Review Focus 3: control tokens match Part 1 tokenization', () => {
  assert.ok(t105.includes('6549') && t105.includes('2752'));
  assert.ok(p1.includes('[40, 628, 6549, 2752, 10204, 436, 10673, 82]'));
});

test('Task 5: Fix round 1 covering tests', () => {
  const ft = section('Fine tuning');
  assert.ok(!ft.includes('0.31'), 'must not contain toy probability 0.31');
  assert.ok(!ft.includes('almost the lowest'), 'must not contain almost the lowest');
  assert.ok(ft.includes('<function=calculator>'), 'must contain <function=calculator>');
  assert.ok(!ft.includes('"arguments"'), 'must not contain "arguments"');
  assert.ok(ft.includes('smuggle in instructions you never wrote'), 'must contain smuggle in instructions you never wrote');
  assert.ok(ft.includes('default'), 'must mention default');

  const dollyMatch = ft.match(/```(?:\w+)?\n([\s\S]*?)```/g);
  const dollyBlock = dollyMatch.find((b) => b.includes('Lollapalooze'));
  assert.ok(dollyBlock, 'dolly code block exists');
  const dollyLines = dollyBlock.trim().split('\n').slice(1, -1);
  assert.ok(dollyLines.length <= 15, `dolly block lines between fences must be <= 15, got ${dollyLines.length}`);
});

test('Task 6: Reasoning figures appear in order', () => {
  order(section('Reasoning'), [
    'p2-imitation-cap',
    'p2-rl-loop',
    'p2-score-source',
    'p2-imitate-vs-discover',
    'p2-think-tokens',
    'p2-cold-start',
  ]);
});

test('Task 6: Reasoning must-have strings are present and retired figures are absent', () => {
  const r = section('Reasoning');
  assert.ok(r.includes('8 to 64'), 'must have 8 to 64');
  assert.ok(r.includes('preserve_thinking'), 'must have preserve_thinking');
  assert.ok(r.includes('2,205'), 'must have 2,205');
  assert.ok(!r.includes('typically thrown away'), 'must not have typically thrown away');
  assert.ok(!r.includes('<Fig name="rl-loop"'), 'must not have rl-loop');
  assert.ok(!r.includes('<Fig name="rl-reward-source"'), 'must not have rl-reward-source');
});

test('Task 6: Fix round 1 covering tests', () => {
  const r = section('Reasoning');
  assert.ok(r.includes('stripped from what is returned to you'), 'must include stripped from what is returned to you');
  assert.ok(r.includes('a convention, not a separate mechanism'), 'must include a convention, not a separate mechanism');
  assert.ok(r.includes('Here the score is trivial'), 'must include Here the score is trivial');
  assert.ok(r.includes('A ship traveling along a river has covered'), 'must include A ship traveling along a river has covered');
  assert.ok(!r.includes('A ship travels 24 km'), 'must not include A ship travels 24 km');
  assert.ok(!r.includes('made up for the picture'), 'must not include made up for the picture');
});

test('Task 7: Preference alignment figures appear in order', () => {
  order(section('Preference alignment'), [
    'p2-obedience',
    'p2-chosen-rejected',
    'p2-safety-data',
    'p2-model-names',
  ]);
});

test('Task 7: Preference alignment must-have strings are present and retired figures are absent', () => {
  const pa = section('Preference alignment');
  assert.ok(pa.includes('82,118'), 'must have 82,118');
  assert.ok(pa.includes('a claim, not a guarantee'), 'must have a claim, not a guarantee');
  assert.ok(!pa.includes('<Fig name="dpo-chosen-rejected"'), 'must not have dpo-chosen-rejected');
});

test('Task 7: Fix round 1 covering test', () => {
  const pa = section('Preference alignment');
  assert.ok(
    pa.includes('Fair warning before you go inspecting it, unlike the Dolly rows'),
    'must include Usman original sentence'
  );
  assert.ok(!pa.includes('because fair warning'), 'must not include fused phrase because fair warning');
});

test('Task 8: Mixture of experts figures appear in order', () => {
  order(section('Mixture of experts'), [
    'p2-dense-waste',
    'p2-experts',
    'p2-router',
    'p2-different-experts',
    'p2-router-learns',
    'p2-total-vs-active',
  ]);
});

test('Task 8: Mixture of experts must-have strings are present and must-not strings are absent', () => {
  const moe = section('Mixture of experts');
  assert.ok(moe.includes('24.35 billion'), 'must have 24.35 billion');
  assert.ok(moe.includes('Qwen3-30B-A3B'), 'must have Qwen3-30B-A3B');
  assert.ok(moe.includes('128 experts'), 'must have 128 experts');
  assert.ok(moe.includes('93.4 GB'), 'must have 93.4 GB');
  assert.ok(moe.includes('compute, not memory'), 'must have compute, not memory');
  assert.ok(!moe.includes('For a 32B dense model'), 'must not have For a 32B dense model');
  assert.ok(!moe.includes('`5120 by 8`'), 'must not have `5120 by 8`');
  assert.ok(!moe.includes('<Fig name="moe-routing"'), 'must not have Fig moe-routing');
  assert.ok(!moe.includes('<Fig name="moe-dense"'), 'must not have Fig moe-dense');
});

test('Task 8: Fix round 1 covering test', () => {
  const moe = section('Mixture of experts');
  assert.ok(
    moe.includes('carrying the knowledge of a 47B one'),
    'must include carrying the knowledge of a 47B one'
  );
  const modelListIdx = moe.indexOf('is a mixture of experts rather than a dense model');
  const computeIdx = moe.indexOf('compute, not memory');
  assert.ok(modelListIdx !== -1, 'must find model list sentence');
  assert.ok(computeIdx !== -1, 'must find compute, not memory');
  assert.ok(
    modelListIdx < computeIdx,
    'model list sentence must appear before compute, not memory'
  );
});

test('Task 9: The GPU compute figures appear in order', () => {
  order(section('The GPU compute'), [
    'p2-independent-dots',
    'p2-cpu-vs-gpu',
    'p2-tensor-core',
    'p2-kernel',
  ]);
});

test('Task 9: The GPU compute must-have strings are present and retired figures are absent', () => {
  const gpu = section('The GPU compute');
  assert.ok(gpu.includes('17,408'), 'must have 17,408');
  assert.ok(gpu.includes('shared memory'), 'must have shared memory');
  assert.ok(gpu.includes('PTX'), 'must have PTX');
  assert.ok(gpu.includes('seventeen thousand independent'), 'must have seventeen thousand independent');
  assert.ok(!gpu.includes('<Fig name="cpu-vs-gpu"'), 'must not have Fig cpu-vs-gpu');
  assert.ok(!gpu.includes('<Fig name="matmul-parallel"'), 'must not have Fig matmul-parallel');
  assert.ok(!gpu.includes('<Fig name="tensor-core"'), 'must not have Fig tensor-core');
  assert.ok(!gpu.includes('<Fig name="kernel-tiling"'), 'must not have Fig kernel-tiling');
});

test('Task 10: KV caching figures appear in order', () => {
  order(section('KV caching and prefill/decode'), [
    'p2-gandalf-loop',
    'p2-old-never-change',
    'p2-decode-step',
    'p2-kv-memory',
    'p2-prefill-decode',
    'p2-decode-limit',
  ]);
});

test('Task 10: KV caching must-have strings are present and retired figures are absent', () => {
  const kv = section('KV caching and prefill/decode');
  assert.ok(kv.includes('64 KiB'), 'must have 64 KiB');
  assert.ok(kv.includes('16 GiB'), 'must have 16 GiB');
  assert.ok(kv.includes('time to first token'), 'must have time to first token');
  assert.ok(kv.includes('tokens per second'), 'must have tokens per second');
  assert.ok(kv.includes('/blog/sre-guide-deploying-llms-part-3/'), 'must link to Part 3');
  const figIdx = kv.indexOf('<DeckFig name="p2-decode-limit"');
  const linkIdx = kv.indexOf('/blog/sre-guide-deploying-llms-part-3/');
  assert.ok(figIdx !== -1, 'must have p2-decode-limit figure');
  assert.ok(linkIdx > figIdx, 'link to Part 3 must appear after p2-decode-limit');
  assert.ok(!kv.includes('<Fig name="kv-cache"'), 'must not have Fig kv-cache');
  assert.ok(!kv.includes('<Fig name="why-cache-kv"'), 'must not have Fig why-cache-kv');
  assert.ok(!kv.includes('<Fig name="prefill-decode"'), 'must not have Fig prefill-decode');
});

test('Task 11: Quantization figures appear in order', () => {
  order(section('Quantization'), [
    'p2-bits',
    'p2-memory-formula',
    'p2-fewer-bits',
    'p2-float-anatomy',
    'p2-block-scales',
    'p2-gptq-awq',
    'p2-kernel-format',
  ]);
});

test('Task 11: Quantization must-have strings are present and retired figures are absent', () => {
  const quant = section('Quantization');
  assert.ok(quant.includes('27,781,427,952'), 'must have 27,781,427,952');
  assert.ok(quant.includes('111.1 GB'), 'must have 111.1 GB');
  assert.ok(quant.includes('55.6 GB'), 'must have 55.6 GB');
  assert.ok(quant.includes('13.9 GB'), 'must have 13.9 GB');
  assert.ok(quant.includes('30.9 GB'), 'must have 30.9 GB');
  assert.ok(quant.includes('| Format | Bits | Layout | Notes |'), 'must have table header');
  assert.ok(quant.includes('0.097 of their spread'), 'must have 0.097 of their spread');
  assert.ok(quant.includes('327,680'), 'must have 327,680');
  assert.ok(quant.includes('Wu'), 'must have Wu');
  assert.ok(quant.includes('nearest of 16 levels'), 'must have nearest of 16 levels');
  assert.ok(!quant.includes('about 128 GB'), 'must not have about 128 GB');
  assert.ok(!quant.includes('<Fig name="bit-drop"'), 'must not have Fig bit-drop');
});

test('Part 2 uses only the deck figures', () => {
  const mdx = readFileSync('src/content/blog/sre-guide-deploying-llms-part-2.mdx', 'utf8');
  assert.ok(!mdx.includes('<Fig '));
  assert.ok(!mdx.includes('AnimRuntime'));
  const body = mdx.replace(/^---[\s\S]*?---/, '');
  const runtime = body.indexOf('<DeckRuntime />');
  assert.ok(runtime > -1 && runtime < body.indexOf('<DeckFig '), 'DeckRuntime comes before the first figure');
});

test('every Part 2 figure appears exactly once, in figures.json order', () => {
  const mdx = readFileSync('src/content/blog/sre-guide-deploying-llms-part-2.mdx', 'utf8');
  const body = mdx.replace(/^---[\s\S]*?---/, '');
  const used = [...body.matchAll(/<DeckFig name="([^"]+)" \/>/g)].map((m) => m[1]);
  assert.deepEqual(used, figures.filter((n) => n.startsWith('p2-')));
});

test('frontmatter marks the revision', () => {
  const mdx = readFileSync('src/content/blog/sre-guide-deploying-llms-part-2.mdx', 'utf8');
  const m = mdx.match(/^---[\s\S]*?\nupdatedDate:\s*([^\n]+)\n[\s\S]*?---/);
  assert.ok(m, 'updatedDate in frontmatter');
  assert.equal(m[1].trim(), '2026-10-23', 'updatedDate is 2026-10-23');
});

test('Task 11: Fix round 1: Part 2 article text contains no references to slides', () => {
  const text = p2();
  assert.ok(!/\bslides?\b/i.test(text), 'Part 2 must refer to figures, not slides');
});








