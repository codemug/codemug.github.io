import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

// Part 3: the hardware and software landscape. Its figures are the h-prefixed deck slides (h001 and up), named p3-*.
const DECK = 'src/components/illustrations/deck';
const mdx = readFileSync('src/content/blog/sre-guide-deploying-llms-part-3.mdx', 'utf8');
const body = mdx.replace(/^---[\s\S]*?---/, '');
const figures = JSON.parse(readFileSync(`${DECK}/figures.json`, 'utf8'));
const manifest = JSON.parse(readFileSync(`${DECK}/slides.json`, 'utf8'));
const names = Object.keys(figures).filter((n) => n.startsWith('p3-'));
const slideId = (s) => (typeof s === 'string' ? s : s.id);
const slideIds = [...new Set(names.flatMap((n) => figures[n].slides.map(slideId)))];

test('Part 3 uses only deck figures, with the runtime before the first one', () => {
  assert.ok(!body.includes('<Fig ') && !mdx.includes('AnimRuntime'), 'a figure of the old animation system is left');
  const runtime = body.indexOf('<DeckRuntime />');
  assert.ok(runtime > -1 && runtime < body.indexOf('<DeckFig '), 'DeckRuntime comes before the first figure');
});

test('every Part 3 figure appears exactly once, in figures.json order, and every figure used exists', () => {
  const used = [...body.matchAll(/<DeckFig name="([^"]+)"\s*\/>/g)].map((m) => m[1]);
  assert.ok(used.length >= 12, `only ${used.length} figures`);
  assert.deepEqual(used, names);
  for (const n of used) assert.ok(figures[n], n);
});

test('every Part 3 slide exists, its steps match the manifest, and each figure has at most 12 states', () => {
  const onDisk = readdirSync(`${DECK}/slides`).filter((f) => /^h\d/.test(f)).map((f) => f.slice(0, -5)).sort();
  assert.deepEqual(onDisk, [...slideIds].sort(), 'no orphan or missing h-slide');
  for (const id of slideIds) {
    const html = readFileSync(`${DECK}/slides/${id}.html`, 'utf8');
    const steps = Number((html.match(/data-steps="(\d+)"/) || [])[1] || 0);
    assert.ok(manifest[id], `manifest entry for ${id}`);
    assert.equal(manifest[id].steps, steps, `steps of ${id}`);
    assert.match(html, new RegExp(`id="${id}"`), `section id of ${id}`);
    assert.match(html, /<title id="[^"]+">[^<]{10,}/, `${id}: an svg title`);
    assert.match(html, /<desc id="[^"]+">[^<]{40,}/, `${id}: an svg description`);
  }
  for (const n of names) {
    const states = figures[n].slides.reduce((a, s) => a + (typeof s === 'string' ? Number((readFileSync(`${DECK}/slides/${s}.html`, 'utf8').match(/data-steps="(\d+)"/) || [])[1] || 0) + 1 : s.steps.length), 0);
    assert.ok(states <= 12, `${n}: ${states} states`);
    for (const c of Object.values(figures[n].captions)) assert.match(c, /\([A-Z][^()]*\.\)$/, `${n}: the caption ends with a tag such as (Illustrative.)`);
  }
});

test('Part 3 keeps the style contract (no em/en dashes, no curly quotes) in the post, captions and slides', () => {
  assert.ok(!/[—–‘’“”]/.test(mdx), 'article');
  for (const n of names) for (const c of Object.values(figures[n].captions)) assert.ok(!/[—–‘’“”]/.test(c), `caption in ${n}`);
  for (const id of slideIds) assert.ok(!/[—–‘’“”]/.test(readFileSync(`${DECK}/slides/${id}.html`, 'utf8')), `slide ${id}`);
});

test('Part 3 slides colour only through the theme variables', () => {
  for (const id of slideIds) {
    const html = readFileSync(`${DECK}/slides/${id}.html`, 'utf8');
    const hex = html.replace(/#f59e0b/gi, '').match(/#[0-9a-fA-F]{3,8}\b/g) || []; // slide ids start with h, so their selectors never match
    assert.deepEqual(hex, [], `${id}: hex colours ${hex.join(', ')}`);
  }
});
