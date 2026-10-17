import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Part 1, rebuilt around the talk deck's figures with Qwen3.8-27B as the running example.
const p1 = readFileSync('src/content/blog/sre-guide-deploying-llms-part-1.mdx', 'utf8');
const figures = Object.keys(JSON.parse(readFileSync('src/components/illustrations/deck/figures.json', 'utf8')));
const body = p1.replace(/^---[\s\S]*?---/, '');

test('Part 1 keeps the style contract (no em/en dashes, no curly quotes)', () => {
  assert.ok(!/[—–‘’“”]/.test(p1));
});

test('Part 1 runs on Qwen3.8-27B, not gemma', () => {
  assert.ok(!/gemma/i.test(p1));
  assert.ok(p1.includes('Qwen3.8-27B'));
  assert.ok(p1.includes('hf download Qwen/Qwen3.8-27B config.json tokenizer.json'));
});

test('Part 1 uses only the deck figures', () => {
  assert.ok(!p1.includes('<Fig '));
  assert.ok(!p1.includes('AnimRuntime'));
  const runtime = body.indexOf('<DeckRuntime />');
  assert.ok(runtime > -1 && runtime < body.indexOf('<DeckFig '), 'DeckRuntime comes before the first figure');
});

test('every figure appears exactly once, in figures.json order', () => {
  const used = [...body.matchAll(/<DeckFig name="([^"]+)" \/>/g)].map((m) => m[1]);
  assert.deepEqual(used, figures);
});

test('the appendix and the retired examples are gone', () => {
  assert.ok(!p1.includes('**Appendix**'));
  assert.ok(!p1.includes("it's raining"));
  assert.ok(!p1.includes('projection vector'));
  assert.ok(!p1.includes('squence'));
});

test('frontmatter marks the revision', () => {
  assert.match(p1, /^---[\s\S]*?\nupdatedDate: 2026-10-17\n[\s\S]*?---/);
});

// Usman's review of the first local build (2026-10-17)
test('review: the primer heading, and its matrix-as-dot-products aside is gone with s08', () => {
  assert.ok(body.includes('## Three Mathematics Concepts Refresher first'));
  assert.ok(!body.includes('## Three tools first'));
  assert.ok(!body.includes('one dot product per column, each one measuring'));
});

test('review: a generic long-word example replaces the employer one', () => {
  assert.ok(!/Careemify/.test(body));
  assert.ok(body.includes('"unbelievably"') && body.includes('`un`, `belie` and `vably`'));
});

test('review: hidden_size leads into a brief, sourced explanation of scaling laws', () => {
  for (const s of ['scaling laws', 'Chinchilla', '20 tokens of training text per parameter', '36 layers', '15 trillion tokens']) assert.ok(body.includes(s), s);
});

test('review: the key is described as the influence a token has to offer', () => {
  assert.ok(body.includes('what influence this token has to offer'));
  assert.ok(body.includes('K holds what influence a token has to offer'));
  assert.ok(!body.includes('K, which represents what this token has to offer'));
});

test('review: the feed-forward overview figure closes the feed-forward mechanics', () => {
  const at = (n) => body.indexOf(`<DeckFig name="${n}" />`);
  assert.ok(at('p1-detectors') < at('p1-ffn-flow') && at('p1-ffn-flow') < at('p1-ffn-recap'));
  assert.ok(body.indexOf("That's the entire feed-forward step") > at('p1-ffn-flow'));
});
