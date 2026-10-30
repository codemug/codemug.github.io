import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const DIR = 'src/components/illustrations/deck';
const figures = JSON.parse(readFileSync(`${DIR}/figures.json`, 'utf8'));
const slideIds = readdirSync(`${DIR}/slides`).filter((f) => f.endsWith('.html')).map((f) => f.slice(0, -5)).sort();
const steps = (id) => Number((readFileSync(`${DIR}/slides/${id}.html`, 'utf8').match(/data-steps="(\d+)"/) || [])[1] || 0);
// a figure lists slide ids, or { id, steps } to show only some of a slide's build steps
const slideId = (s) => (typeof s === 'string' ? s : s.id);
const stepsOf = (s) => (typeof s === 'string' ? Array.from({ length: steps(s) + 1 }, (_, i) => i) : s.steps);

test("the slides are the deck's non-decorative slides plus the trainpass slide", () => {
  assert.equal(slideIds.filter((id) => !/^d\d/.test(id)).length, 112); // Part 4's own slides (d-prefixed) are covered by part4.test.mjs
  for (const id of ['s02-vec2d', 's41-wu-wd-intro', 's45-ffn-flow', 't709-native-support', 'x01-trainpass']) {
    assert.ok(slideIds.includes(id), `should include ${id}`);
  }
  for (const id of ['s04-vec-many', 's08-matmul-dots', 's41-ffn-flow', 's53-sampling-board', 's55-recap', 's01-cover', 't001-cover', 't100-title-finetuning']) {
    assert.ok(!slideIds.includes(id), `should exclude ${id}`);
  }
});

test('every Part 1 slide is used by exactly one p1 figure', () => {
  const p1Figures = Object.entries(figures).filter(([name]) => name.startsWith('p1-')).map(([, f]) => f);
  const p1Used = p1Figures.flatMap((f) => f.slides.map(slideId));
  assert.equal(new Set(p1Used).size, p1Used.length, 'a slide is used twice');
  const p1Expected = slideIds.filter((id) => /^[sx]/.test(id)).sort();
  assert.deepEqual([...p1Used].sort(), p1Expected);
});

test('every slide in a figure has a caption', () => {
  for (const [name, f] of Object.entries(figures)) {
    for (const id of f.slides.map(slideId)) assert.ok((f.captions[id] || '').trim().length > 20, `${name}: ${id}`);
    assert.deepEqual(Object.keys(f.captions).sort(), f.slides.map(slideId).sort(), `${name}: captions for other slides`);
  }
});

test('no figure holds more than 12 states', () => {
  for (const [name, f] of Object.entries(figures)) {
    const states = f.slides.reduce((a, s) => a + stepsOf(s).length, 0);
    assert.ok(states <= 12, `${name}: ${states} states`);
  }
});

test('captions keep the style contract (no em/en dashes, no curly quotes)', () => {
  for (const [name, f] of Object.entries(figures)) {
    for (const [id, c] of Object.entries(f.captions)) assert.ok(!/[—–‘’“”]/.test(c), `${name}: ${id}`);
  }
});

test('review: vector figure merges the identical 3D steps; s08 and s41 move', () => {
  assert.deepEqual(figures['p1-vectors'].slides, ['s02-vec2d', 's03-vec3d']);
  assert.deepEqual(figures['p1-dot'].slides, ['s07-dot-intro']);
  assert.deepEqual(figures['p1-world-cup'].slides, ['s40-world-cup']);
  assert.deepEqual(figures['p1-ffn-flow'].slides, ['s45-ffn-flow']);
  const names = Object.keys(figures);
  assert.ok(names.indexOf('p1-world-cup') < names.indexOf('p1-wu-wd') &&
            names.indexOf('p1-wu-wd') < names.indexOf('p1-detectors') &&
            names.indexOf('p1-detectors') < names.indexOf('p1-ffn-flow') &&
            names.indexOf('p1-ffn-flow') < names.indexOf('p1-ffn-recap'));
  assert.match(figures['p1-key-value'].captions['s34-key'], /what kind of influence this token has to offer/);
});

test('review 2: the vector figure drops the thousands-of-numbers slide (s04) and ends on the 3D vector', () => {
  const v = figures['p1-vectors'].slides;
  assert.deepEqual(v, ['s02-vec2d', 's03-vec3d']);
  assert.equal(v.reduce((a, s) => a + stepsOf(s).length, 0), 4);
});

test("Part 1 follows the deck's slide changes", () => {
  assert.deepEqual(figures['p1-wu-wd'].slides, ['s41-wu-wd-intro']);
  assert.equal(figures['p1-sampling-board'], undefined);
  assert.equal(figures['p1-recap'], undefined);
  assert.ok(figures['p1-not-words'].captions['s14-not-words'].includes('8 tokens'));
  const p1Captions = Object.entries(figures)
    .filter(([name]) => name.startsWith('p1-'))
    .flatMap(([, f]) => Object.values(f.captions));
  for (const c of p1Captions) {
    assert.ok(!/reliably|54488|7 tokens/.test(c), `caption should not match /reliably|54488|7 tokens/: ${c}`);
  }
});

const P2 = [
  ['p2-left-off', ['t002-left-off']],
  ['p2-two-threads', ['t003-two-threads']],
  ['p2-base-continues', ['t101-base-continues']],
  ['p2-sft', ['t102-sft-pairs']],
  ['p2-dolly', ['t103-dolly-row']],
  ['p2-chat-template', ['t104-chat-template', 't105-control-tokens']],
  ['p2-template-knobs', ['t106-template-knobs']],
  ['p2-tool-calling', ['t107-tool-calling']],
  ['p2-imitation-cap', ['t201-imitation-cap']],
  ['p2-rl-loop', ['t202-try-and-grade', 't203-advantage', 't204-reinforce']],
  ['p2-score-source', ['t205-score-source', 't206-reward-model']],
  ['p2-imitate-vs-discover', ['t207-imitate-vs-discover']],
  ['p2-think-tokens', ['t208-think-tokens']],
  ['p2-cold-start', ['t209-cold-start']],
  ['p2-obedience', ['t301-obedience', 't302-repeat-anything']],
  ['p2-chosen-rejected', ['t303-chosen-rejected', 't304-preference-nudge']],
  ['p2-safety-data', ['t305-safety-data']],
  ['p2-model-names', ['t306-model-names']],
  ['p2-dense-waste', ['t401-dense-touches-all', 't402-wasted']],
  ['p2-experts', ['t403-not-all-knowledge', 't404-split-into-experts']],
  ['p2-router', ['t405-router-scores', 't406-top2']],
  ['p2-different-experts', ['t407-different-experts']],
  ['p2-router-learns', ['t408-router-learns', 't409-load-balance']],
  ['p2-total-vs-active', ['t410-total-vs-active', 't411-memory-not-compute']],
  ['p2-independent-dots', ['t501-independent-dots']],
  ['p2-cpu-vs-gpu', ['t502-cpu-vs-gpu', 't503-cpu-overhead']],
  ['p2-tensor-core', ['t504-tensor-core', 't505-keep-the-sum']],
  ['p2-kernel', ['t506-kernel-schedules', 't507-cuda-to-silicon']],
  ['p2-gandalf-loop', ['t601-gandalf-loop', 't602-redo-everything']],
  ['p2-old-never-change', ['t603-old-never-change']],
  ['p2-decode-step', ['t604-keep-kv-drop-q', 't605-decode-step']],
  ['p2-kv-memory', ['t606-kv-memory']],
  ['p2-prefill-decode', ['t607-prefill-vs-decode', 't608-two-phases']],
  ['p2-decode-limit', ['t609-decode-limit']],
  ['p2-bits', ['t701-bits']],
  ['p2-memory-formula', ['t702-memory-formula']],
  ['p2-fewer-bits', ['t703-fewer-bits', 't704-snap-to-levels']],
  ['p2-float-anatomy', ['t705-float-anatomy']],
  ['p2-block-scales', ['t706-block-scales']],
  ['p2-gptq-awq', ['t707-gptq-awq']],
  ['p2-kernel-format', ['t708-kernel-speaks-format', 't709-native-support']],
];

test('every Part 2 slide is used by exactly one p2 figure', () => {
  const p2Figures = Object.entries(figures).filter(([name]) => name.startsWith('p2-')).map(([, f]) => f);
  const p2Used = p2Figures.flatMap((f) => f.slides.map(slideId));
  assert.equal(new Set(p2Used).size, p2Used.length, 'a Part 2 slide is used twice');
  const p2Expected = slideIds.filter((id) => id.startsWith('t')).sort();
  assert.deepEqual([...p2Used].sort(), p2Expected);
});

test('the p2 figures follow the spec map', () => {
  const p2Entries = Object.entries(figures)
    .filter(([name]) => name.startsWith('p2-'))
    .map(([name, f]) => [name, f.slides.map(slideId)]);
  assert.deepEqual(p2Entries, P2);
});

test('text-heavy Part 2 figures dwell long enough', () => {
  for (const name of ['p2-template-knobs', 'p2-safety-data', 'p2-total-vs-active', 'p2-kv-memory', 'p2-decode-limit', 'p2-memory-formula']) {
    assert.ok(figures[name] && figures[name].dwell >= 4500, `${name} dwell should be >= 4500`);
  }
});
