import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';

// Parts 4 and 5: deploying the stack, in two posts. Their figures are the d-prefixed deck slides (ids d001 to d702):
// the figures of part 4 are named p4-*, the figures of part 5 are named p5-*.
const DECK = 'src/components/illustrations/deck';
const examplesDir = 'public/examples/sre-guide-part-4';
const figures = JSON.parse(readFileSync(`${DECK}/figures.json`, 'utf8'));
const manifest = JSON.parse(readFileSync(`${DECK}/slides.json`, 'utf8'));
const slideId = (s) => (typeof s === 'string' ? s : s.id);

// each post lists the example files it relies on
const POSTS = [
  {
    name: 'Part 4', prefix: 'p4-', file: 'src/content/blog/sre-guide-deploying-llms-part-4.mdx',
    examples: ['README.md', 'k8s/nodepool.yaml', 'k8s/ec2nodeclass.yaml', 'k8s/vllm-deployment.yaml',
      'helm/llm-serving/Chart.yaml', 'helm/llm-serving/values.yaml', 'helm/llm-serving/values.schema.json',
      'helm/llm-serving/templates/_helpers.tpl', 'helm/llm-serving/templates/nodepool.yaml', 'helm/llm-serving/templates/deployment.yaml',
      'terraform/versions.tf', 'terraform/variables.tf', 'terraform/eks.tf', 'terraform/karpenter.tf', 'terraform/lb_controller.tf',
      'terraform/checks.tf', 'terraform/s3.tf', 'terraform/pod_identity.tf', 'terraform/outputs.tf'],
    minIncluded: 8,
  },
  {
    name: 'Part 5', prefix: 'p5-', file: 'src/content/blog/sre-guide-deploying-llms-part-5.mdx',
    examples: ['k8s/vllm-deployment-tiered.yaml', 'k8s/kv-guard-configmap.yaml', 'k8s/scaledobject.yaml', 'k8s/queries.rules.yml',
      'k8s/queries.test.yml', 'k8s/podmonitors.yaml', 'k8s/epp-values.yaml', 'k8s/epp-values-precise.yaml', 'k8s/gateway.yaml',
      'k8s/aigatewayroute.yaml', 'helm/llm-serving/templates/scaledobject.yaml', 'helm/llm-serving/templates/prometheusrule.yaml',
      'platform/README.md', 'platform/kube-prometheus-stack-values.yaml', 'platform/envoy-gateway-values.yaml',
      'platform/envoy-gateway-values-addon.yaml', 'simulation/README.md', 'simulation/traffic.py', 'simulation/fake_vllm.py'],
    minIncluded: 8,
  },
].map((p) => {
  const mdx = readFileSync(p.file, 'utf8');
  const body = mdx.replace(/^---[\s\S]*?---/, '');
  const names = Object.keys(figures).filter((n) => n.startsWith(p.prefix));
  return {
    ...p, mdx, body, names,
    // prose only: drop fenced code blocks and inline code
    prose: body.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, ''),
    slideIds: [...new Set(names.flatMap((n) => figures[n].slides.map(slideId)))],
  };
});
const allSlideIds = POSTS.flatMap((p) => p.slideIds);

for (const post of POSTS) {
  test(`${post.name} keeps the style contract (no em/en dashes, no curly quotes) in the post, captions and slides`, () => {
    assert.ok(!/[—–‘’“”]/.test(post.mdx), 'article');
    for (const n of post.names) for (const c of Object.values(figures[n].captions)) assert.ok(!/[—–‘’“”]/.test(c), `caption in ${n}`);
    for (const id of post.slideIds) {
      const html = readFileSync(`${DECK}/slides/${id}.html`, 'utf8');
      assert.ok(!/[—–‘’“”]/.test(html), `slide ${id}`);
    }
  });

  test(`${post.name}: every code block that comes from an example file was resolved from a real file`, () => {
    assert.ok(!/^@@(raw|chart|values|tf|plat|hl|diff)\b/m.test(post.mdx) && !/^@@@/m.test(post.mdx), 'an unresolved include marker');
    const fromFiles = [...post.mdx.matchAll(/```[a-z]*\n# ((?:k8s|helm\/llm-serving|terraform|platform)\/[^\n]+)\n/g)].map((m) => m[1].replace(/ \(.*\)$/, ''));
    assert.ok(fromFiles.length >= post.minIncluded, `only ${fromFiles.length} included code blocks`);
    for (const f of fromFiles) assert.ok(existsSync(`${examplesDir}/${f}`), f);
  });

  test(`${post.name} has frontmatter and uses only the deck figures`, () => {
    for (const key of ['title', 'description', 'pubDate', 'tags']) assert.match(post.mdx, new RegExp(`^${key}:`, 'm'), key);
    assert.ok(!post.mdx.includes('<Fig ') && !post.mdx.includes('AnimRuntime'));
    const runtime = post.body.indexOf('<DeckRuntime />');
    assert.ok(runtime > -1 && runtime < post.body.indexOf('<DeckFig '), 'DeckRuntime comes before the first figure');
  });

  test(`${post.name}: every figure appears exactly once, in figures.json order, and every figure used exists`, () => {
    const used = [...post.body.matchAll(/<DeckFig name="([^"]+)"\s*\/>/g)].map((m) => m[1]);
    assert.deepEqual(used, post.names);
    for (const n of used) assert.ok(figures[n], n);
  });

  test(`${post.name}: every slide exists, its steps match the manifest, and each figure has at most 12 states`, () => {
    assert.ok(post.slideIds.length >= 5, `only ${post.slideIds.length} slides`);
    for (const id of post.slideIds) {
      const html = readFileSync(`${DECK}/slides/${id}.html`, 'utf8');
      const steps = Number((html.match(/data-steps="(\d+)"/) || [])[1] || 0);
      assert.ok(manifest[id], `manifest entry for ${id}`);
      assert.equal(manifest[id].steps, steps, `steps of ${id}`);
      assert.match(html, new RegExp(`id="${id}"`), `section id of ${id}`);
    }
    for (const n of post.names) {
      const states = figures[n].slides.reduce((a, s) => a + (typeof s === 'string' ? Number((readFileSync(`${DECK}/slides/${s}.html`, 'utf8').match(/data-steps="(\d+)"/) || [])[1] || 0) + 1 : s.steps.length), 0);
      assert.ok(states <= 12, `${n}: ${states} states`);
    }
  });

  test(`${post.name} links the examples, and the example files it relies on are all there`, () => {
    assert.ok(post.mdx.includes('public/examples/sre-guide-part-4'));
    for (const f of post.examples) assert.ok(existsSync(`${examplesDir}/${f}`), f);
  });

  test(`${post.name}: the manifests in the post use one naming set`, () => {
    assert.ok(!/qwen3\.8-27b(?!-)/.test(post.prose.replace(/Qwen3\.8-27B/g, '')), 'a stale served-model name');
  });
}

test('the slides on disk are exactly the slides of part 4 and part 5, with no orphan and none missing', () => {
  const onDisk = readdirSync(`${DECK}/slides`).filter((f) => /^d\d/.test(f)).map((f) => f.slice(0, -5)).sort();
  assert.deepEqual(onDisk, [...allSlideIds].sort());
});

test('the manifests and values use one served-model name', () => {
  for (const f of ['k8s/vllm-deployment.yaml', 'k8s/scaledobject.yaml', 'helm/llm-serving/values.yaml']) {
    assert.ok(readFileSync(`${examplesDir}/${f}`, 'utf8').includes('qwen38-27b-nvfp4'), f);
  }
});

test('nothing company-internal reaches the public posts, slides or examples', () => {
  const banned = /careem|prod-control|aue1a|prod-sbx|dev-sre|inference-manager|AKIA[0-9A-Z]{8,}|\b(?!1{12}\b)\d{12}\b/i;
  for (const post of POSTS) assert.ok(!banned.test(post.mdx), post.name);
  for (const id of allSlideIds) assert.ok(!banned.test(readFileSync(`${DECK}/slides/${id}.html`, 'utf8')), id);
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.name === '.terraform' || e.name.endsWith('.tgz')) return [];
    return e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`];
  });
  if (existsSync(examplesDir)) {
    for (const f of walk(examplesDir)) assert.ok(!banned.test(readFileSync(f, 'utf8')), f);
  }
});

test('part 5 refers to part 4 and part 4 refers to part 5 with a link', () => {
  const [p4, p5] = POSTS;
  assert.ok(p4.mdx.includes('](/blog/sre-guide-deploying-llms-part-5/)'));
  assert.ok(p5.mdx.includes('](/blog/sre-guide-deploying-llms-part-4/)'));
  // a section reference in part 4 never points at a section that only exists in part 5
  const sections4 = [...p4.body.matchAll(/^## (\d+)\./gm)].map((m) => Number(m[1]));
  for (const m of p4.prose.matchAll(/\bsection (\d+)\b/g)) assert.ok(sections4.includes(Number(m[1])), `part 4 mentions section ${m[1]}`);
  // a section reference in part 5 is either one of its own sections or says it means part 4
  const sections5 = [...p5.body.matchAll(/^## (\d+)\./gm)].map((m) => Number(m[1]));
  for (const m of p5.prose.matchAll(/\bsections? (\d+)\b(?! of part 4)/g)) assert.ok(sections5.includes(Number(m[1])), `part 5 mentions section ${m[1]}`);
});
