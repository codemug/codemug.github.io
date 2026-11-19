import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const page = readFileSync(new URL('../src/pages/index.astro', import.meta.url), 'utf8');
const script = page.match(/<script>([\s\S]*?)<\/script>/)[1];

function hero({ reduced = false } = {}) {
  const frames = new Map();
  const observers = [];
  const events = new Map();
  let nextFrame = 0;
  let draws = 0;
  const listen = (prefix) => (name, callback) => events.set(`${prefix}:${name}`, callback);
  const ctx = new Proxy({ clearRect: () => draws++ }, {
    get: (target, key) => target[key] ?? (() => {}),
  });
  const canvas = {
    getContext: () => ctx,
    getBoundingClientRect: () => ({ width: 800, height: 600 }),
  };
  const preference = { matches: reduced, addEventListener: listen('motion') };
  const document = {
    hidden: false,
    querySelectorAll: () => [],
    getElementById: (id) => id === 'netcanvas' ? canvas : null,
    addEventListener: listen('document'),
  };
  vm.runInNewContext(script, {
    document,
    window: { matchMedia: () => preference, addEventListener: listen('window') },
    IntersectionObserver: class {
      constructor(callback) { this.callback = callback; observers.push(this); }
      observe(target) { this.target = target; }
      unobserve() {}
    },
    requestAnimationFrame: (callback) => { frames.set(++nextFrame, callback); return nextFrame; },
    cancelAnimationFrame: (id) => frames.delete(id),
    setTimeout: () => {},
  });
  return {
    frames,
    get draws() { return draws; },
    intersect(value) { observers.find((observer) => observer.target === canvas).callback([{ isIntersecting: value }]); },
    hidden(value) { document.hidden = value; events.get('document:visibilitychange')(); },
    motion(value) { preference.matches = value; events.get('motion:change')(); },
    event(name) { events.get(`window:${name}`)(); },
    tick() {
      const scheduled = [...frames];
      frames.clear();
      for (const [, callback] of scheduled) callback();
    },
  };
}

test('hero schedules one loop only while visible and resumes after page restoration', () => {
  const h = hero();
  assert.equal(h.frames.size, 0);
  h.intersect(true);
  h.intersect(true);
  assert.equal(h.frames.size, 1, 'duplicate observer callbacks must not create loops');
  h.tick();
  assert.equal(h.draws, 1);
  assert.equal(h.frames.size, 1);
  h.intersect(false);
  assert.equal(h.frames.size, 0, 'offscreen cancels pending work');
  h.tick();
  assert.equal(h.draws, 1);
  h.intersect(true);
  h.hidden(true);
  assert.equal(h.frames.size, 0, 'background tabs stop');
  h.hidden(false);
  assert.equal(h.frames.size, 1);
  h.event('pagehide');
  assert.equal(h.frames.size, 0);
  h.event('pageshow');
  assert.equal(h.frames.size, 1, 'bfcache restoration resumes exactly once');
});

test('hero honors initial and changed reduced-motion preference', () => {
  const h = hero({ reduced: true });
  h.intersect(true);
  assert.equal(h.frames.size, 0);
  h.motion(false);
  assert.equal(h.frames.size, 1);
  h.tick();
  h.motion(true);
  assert.equal(h.frames.size, 0);
  h.tick();
  assert.equal(h.draws, 1);
  h.intersect(false);
  h.motion(false);
  assert.equal(h.frames.size, 0, 'motion preference must not restart an offscreen hero');
});
