import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';

// Part 4: deploying the stack. Its figures are the d-prefixed deck slides (ids d001 to d702), named p4-*.
const DECK = 'src/components/illustrations/deck';
const mdx = readFileSync('src/content/blog/sre-guide-deploying-llms-part-4.mdx', 'utf8');
const body = mdx.replace(/^---[\s\S]*?---/, '');
const figures = JSON.parse(readFileSync(`${DECK}/figures.json`, 'utf8'));
const manifest = JSON.parse(readFileSync(`${DECK}/slides.json`, 'utf8'));
const p4Names = Object.keys(figures).filter((n) => n.startsWith('p4-'));
const slideId = (s) => (typeof s === 'string' ? s : s.id);
const p4SlideIds = [...new Set(p4Names.flatMap((n) => figures[n].slides.map(slideId)))];
const examplesDir = 'public/examples/sre-guide-part-4';

// prose only: drop fenced code blocks and inline code
const prose = body.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');

test('Part 4 keeps the style contract (no em/en dashes, no curly quotes) in the post, captions and slides', () => {
  assert.ok(!/[—–‘’“”]/.test(mdx), 'article');
  for (const n of p4Names) for (const c of Object.values(figures[n].captions)) assert.ok(!/[—–‘’“”]/.test(c), `caption in ${n}`);
  for (const id of p4SlideIds) {
    const html = readFileSync(`${DECK}/slides/${id}.html`, 'utf8');
    assert.ok(!/[—–‘’“”]/.test(html), `slide ${id}`);
  }
});

test('Part 4 prose has no contractions (parts 2 and 3 do not use them)', () => {
  const m = prose.match(/\b(?:don't|can't|won't|isn't|aren't|doesn't|didn't|wasn't|weren't|couldn't|shouldn't|wouldn't|hasn't|haven't|it's|that's|there's|here's|let's|I'm|I've|I'd|I'll|we're|we've|you're|you've|you'll|they're)\b/i);
  assert.equal(m, null, `contraction: ${m && m[0]}`);
});

test('Part 4 has frontmatter and uses only the deck figures', () => {
  for (const key of ['title', 'description', 'pubDate', 'tags']) assert.match(mdx, new RegExp(`^${key}:`, 'm'), key);
  assert.ok(!mdx.includes('<Fig ') && !mdx.includes('AnimRuntime'));
  const runtime = body.indexOf('<DeckRuntime />');
  assert.ok(runtime > -1 && runtime < body.indexOf('<DeckFig '), 'DeckRuntime comes before the first figure');
});

test('every p4 figure appears exactly once, in figures.json order, and every figure used exists', () => {
  const used = [...body.matchAll(/<DeckFig name="([^"]+)"\s*\/>/g)].map((m) => m[1]);
  assert.deepEqual(used, p4Names);
  for (const n of used) assert.ok(figures[n], n);
});

test('every p4 slide exists, its steps match the manifest, and each figure has at most 12 states', () => {
  assert.ok(p4SlideIds.length >= 20, `only ${p4SlideIds.length} slides`);
  const onDisk = readdirSync(`${DECK}/slides`).filter((f) => /^d\d/.test(f)).map((f) => f.slice(0, -5)).sort();
  assert.deepEqual(onDisk, [...p4SlideIds].sort(), 'no orphan or missing d-slide');
  for (const id of p4SlideIds) {
    const html = readFileSync(`${DECK}/slides/${id}.html`, 'utf8');
    const steps = Number((html.match(/data-steps="(\d+)"/) || [])[1] || 0);
    assert.ok(manifest[id], `manifest entry for ${id}`);
    assert.equal(manifest[id].steps, steps, `steps of ${id}`);
    assert.match(html, new RegExp(`id="${id}"`), `section id of ${id}`);
  }
  for (const n of p4Names) {
    const states = figures[n].slides.reduce((a, s) => a + (typeof s === 'string' ? Number((readFileSync(`${DECK}/slides/${s}.html`, 'utf8').match(/data-steps="(\d+)"/) || [])[1] || 0) + 1 : s.steps.length), 0);
    assert.ok(states <= 12, `${n}: ${states} states`);
  }
});

test('nothing company-internal reaches the public post, slides or examples', () => {
  const banned = /careem|prod-control|aue1a|prod-sbx|dev-sre|inference-manager|AKIA[0-9A-Z]{8,}|\b(?!1{12}\b)\d{12}\b/i;
  assert.ok(!banned.test(mdx), 'article');
  for (const id of p4SlideIds) assert.ok(!banned.test(readFileSync(`${DECK}/slides/${id}.html`, 'utf8')), id);
  if (existsSync(examplesDir)) {
    for (const f of readdirSync(examplesDir)) assert.ok(!banned.test(readFileSync(`${examplesDir}/${f}`, 'utf8')), f);
  }
});

test('the post links the validated examples and they are all there', () => {
  assert.ok(mdx.includes('public/examples/sre-guide-part-4'));
  for (const f of ['README.md', 'nodepool.yaml', 'ec2nodeclass.yaml', 'vllm-deployment.yaml', 'vllm-deployment-tiered.yaml',
    'kv-guard-configmap.yaml', 'scaledobject.yaml', 'queries.rules.yml', 'queries.test.yml']) {
    assert.ok(existsSync(`${examplesDir}/${f}`), f);
  }
});

test('the manifests in the post use one naming set', () => {
  assert.ok(!/qwen3\.8-27b(?!-)/.test(prose.replace(/Qwen3\.8-27B/g, '')), 'a stale served-model name');
  for (const f of ['vllm-deployment.yaml', 'scaledobject.yaml']) {
    assert.ok(readFileSync(`${examplesDir}/${f}`, 'utf8').includes('qwen38-27b-nvfp4'), f);
  }
});
