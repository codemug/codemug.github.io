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
const used = Object.values(figures).flatMap((f) => f.slides.map(slideId));
// slides deliberately left out of the article (Usman's reviews, 2026-10-17)
const UNUSED = ['s04-vec-many', 's08-matmul-dots'];

test('the slides are the deck slides s02 to s55 plus the trainpass slide', () => {
  assert.equal(slideIds.length, 55);
  assert.equal(slideIds[0], 's02-vec2d');
  assert.ok(slideIds.includes('s55-recap'));
  assert.ok(slideIds.includes('x01-trainpass'));
});

test('every slide is used by exactly one figure', () => {
  assert.equal(new Set(used).size, used.length, 'a slide is used twice');
  assert.deepEqual([...used, ...UNUSED].sort(), slideIds);
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
  assert.deepEqual(figures['p1-vectors'].slides[1], { id: 's03-vec3d', steps: [0, 3] });
  assert.deepEqual(figures['p1-dot'].slides, ['s07-dot-intro']);
  assert.deepEqual(figures['p1-world-cup'].slides, ['s40-world-cup']);
  assert.deepEqual(figures['p1-ffn-flow'].slides, ['s41-ffn-flow']);
  const names = Object.keys(figures);
  assert.ok(names.indexOf('p1-detectors') < names.indexOf('p1-ffn-flow') && names.indexOf('p1-ffn-flow') < names.indexOf('p1-ffn-recap'));
  assert.ok(/what influence this token has to offer/.test(figures['p1-key-value'].captions['s34-key']));
});

test('review 2: the vector figure drops the thousands-of-numbers slide (s04) and ends on the 3D vector', () => {
  const v = figures['p1-vectors'].slides;
  assert.deepEqual(v, ['s02-vec2d', { id: 's03-vec3d', steps: [0, 3] }]);
  assert.equal(v.reduce((a, s) => a + stepsOf(s).length, 0), 5);
});
