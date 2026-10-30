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

test('every code block that comes from an example file was resolved from a real file', () => {
  assert.ok(!/^@@(raw|chart|values|tf)\b/m.test(mdx), 'an unresolved include marker');
  const fromFiles = [...mdx.matchAll(/```[a-z]*\n# ((?:k8s|helm\/llm-serving|terraform)\/[^\n]+)\n/g)].map((m) => m[1].replace(/ \(.*\)$/, ''));
  assert.ok(fromFiles.length >= 15, `only ${fromFiles.length} included code blocks`);
  for (const f of fromFiles) assert.ok(existsSync(`${examplesDir}/${f}`), f);
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
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.name === '.terraform' || e.name.endsWith('.tgz')) return [];
    return e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`];
  });
  if (existsSync(examplesDir)) {
    for (const f of walk(examplesDir)) assert.ok(!banned.test(readFileSync(f, 'utf8')), f);
  }
});

test('the post links the examples and the raw manifests, the Helm chart and the Terraform module are all there', () => {
  assert.ok(mdx.includes('public/examples/sre-guide-part-4'));
  for (const f of ['README.md', 'k8s/nodepool.yaml', 'k8s/ec2nodeclass.yaml', 'k8s/vllm-deployment.yaml', 'k8s/vllm-deployment-tiered.yaml',
    'k8s/kv-guard-configmap.yaml', 'k8s/scaledobject.yaml', 'k8s/queries.rules.yml', 'k8s/queries.test.yml',
    'helm/llm-serving/Chart.yaml', 'helm/llm-serving/values.yaml', 'helm/llm-serving/values.schema.json',
    'helm/llm-serving/templates/_helpers.tpl', 'helm/llm-serving/templates/nodepool.yaml', 'helm/llm-serving/templates/deployment.yaml',
    'helm/llm-serving/templates/scaledobject.yaml', 'helm/llm-serving/templates/prometheusrule.yaml',
    'terraform/versions.tf', 'terraform/variables.tf', 'terraform/eks.tf', 'terraform/karpenter.tf', 'terraform/addons.tf',
    'terraform/s3.tf', 'terraform/pod_identity.tf', 'terraform/outputs.tf']) {
    assert.ok(existsSync(`${examplesDir}/${f}`), f);
  }
});

test('the manifests in the post use one naming set', () => {
  assert.ok(!/qwen3\.8-27b(?!-)/.test(prose.replace(/Qwen3\.8-27B/g, '')), 'a stale served-model name');
  for (const f of ['k8s/vllm-deployment.yaml', 'k8s/scaledobject.yaml', 'helm/llm-serving/values.yaml']) {
    assert.ok(readFileSync(`${examplesDir}/${f}`, 'utf8').includes('qwen38-27b-nvfp4'), f);
  }
});
