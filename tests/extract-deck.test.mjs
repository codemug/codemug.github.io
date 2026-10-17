import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { extractSlides, rewriteViewportUnits, unscopedSelectors, extractBaseCss } from '../scripts/extract-deck.mjs';

const HAVE_DECK = existsSync('deck.html');
const deck = () => readFileSync('deck.html', 'utf8');

test('rewriteViewportUnits converts to the 1280x720 frame', () => {
  assert.equal(
    rewriteViewportUnits('a{width:94vw;height:100dvh;padding:clamp(10px,2vh,20px)}'),
    'a{width:1203.2px;height:720px;padding:clamp(10px,14.4px,20px)}'
  );
});

test('rewriteViewportUnits leaves non-viewport units and identifiers alone', () => {
  assert.equal(rewriteViewportUnits('b{margin:2em 4px;--vh-ish:1;width:calc(100% - 2vw)}'),
    'b{margin:2em 4px;--vh-ish:1;width:calc(100% - 25.6px)}');
});

test('unscopedSelectors reports selectors outside the slide id', () => {
  const slide = { id: 's99-x', html: '<section id="s99-x"><style>#s99-x .a{x:1} .b, #s99-x .c{y:2} @media(max-width:9px){.d{z:3}} @keyframes k{from{a:1}to{a:2}}</style></section>' };
  assert.deepEqual(unscopedSelectors(slide), ['.b', '.d']);
});

test('extractSlides finds all 56 slides with steps and notes', { skip: !HAVE_DECK }, () => {
  const s = extractSlides(deck());
  assert.equal(s.length, 56);
  assert.equal(s[0].id, 's01-cover');
  assert.equal(s.at(-1).id, 's55-recap');
  assert.equal(s.find((x) => x.id === 's30-ball-3d').steps, 4);
  assert.ok(s.every((x) => !x.html.includes('class="notes"')));
  assert.match(s.find((x) => x.id === 's30-ball-3d').notes, /^SAY: golf ball/);
  assert.equal(s.find((x) => x.id === 's30-ball-3d').statement, 'Each ball is the same vector, transformed in a different direction.');
  assert.ok(s.find((x) => x.id === 's53-sampling-board').html.includes('<iframe'));
});

test('extracted slides carry no viewport units in their styles', { skip: !HAVE_DECK }, () => {
  const s = extractSlides(deck());
  for (const x of s) {
    // the sampling board's srcdoc is its own document with its own viewport: left as is
    const h = x.html.replace(/srcdoc="[^"]*"/g, '');
    const styles = [...h.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n')
      + [...h.matchAll(/style="([^"]*)"/g)].map((m) => m[1]).join('\n');
    assert.ok(!/\d(vw|vh|dvh|svh|vmin|vmax)\b/.test(styles), x.id);
  }
});

test('slide styles are id-scoped and keyframes do not clash with the site', { skip: !HAVE_DECK }, () => {
  const s = extractSlides(deck()).filter((x) => !/^s01-/.test(x.id));
  assert.deepEqual(s.flatMap(unscopedSelectors), []);
  assert.ok(!s.some((x) => /@keyframes\s+(flow|pulse|rise)\b/.test(x.html)));
});

test('extractBaseCss scopes the deck base styles under the figure frame', { skip: !HAVE_DECK }, () => {
  const css = extractBaseCss(deck());
  const selectors = [];
  // every rule selector (outside @media headers) must start with the frame scope
  css.replace(/(^|})\s*([^{}@]+)\{/g, (_, __, sel) => { selectors.push(...sel.split(',').map((x) => x.trim())); return ''; });
  assert.ok(selectors.length > 80, `only ${selectors.length} selectors`);
  assert.deepEqual(selectors.filter((s) => !s.startsWith('.dk .dk-frame')), []);
  assert.ok(css.includes('.dk .dk-frame .slide.visible{'));
  assert.ok(css.includes('.dk .dk-frame [data-from].on{'));
  assert.ok(!/\.deck-(progress|dots|counter|hints|pips|tools|notes)/.test(css), 'deck chrome must not be ported');
  assert.ok(!/\d(vw|vh|dvh|svh|vmin|vmax)\b/.test(css), 'viewport units must be rewritten');
  assert.ok(!/(^|[\s,}])(html|body)\b/.test(css), 'page-level rules must not be ported');
});

test('s15 measures its rows in frame pixels (divides by the figure scale)', { skip: !HAVE_DECK }, () => {
  const s15 = extractSlides(deck()).find((x) => x.id === 's15-model-folder').html;
  assert.ok(s15.includes('k = Deck.scale(term)'));
  assert.ok(s15.includes('((a.top - t0) / k).toFixed(1)'));
  assert.ok(s15.includes('((b.bottom - a.top) / k).toFixed(1)'));
});

// colours the slides hard-code for the dark theme: they must follow the site theme instead
const TOKEN_TRIPLES = /\[\s*(34,\s*211,\s*238|237,\s*237,\s*240|196,\s*196,\s*203|154,\s*154,\s*163|106,\s*106,\s*115|74,\s*74,\s*82)\s*\]/;

test('slide scripts read theme colours live instead of hard-coding dark-theme RGB', { skip: !HAVE_DECK }, () => {
  const s = extractSlides(deck()).filter((x) => !/^s01-/.test(x.id));
  const left = s.filter((x) => TOKEN_TRIPLES.test(x.html.replace(/srcdoc="[^"]*"/g, ''))).map((x) => x.id);
  assert.deepEqual(left, []);
  const s26 = s.find((x) => x.id === 's26-nudge-all').html;
  assert.ok(s26.includes("Deck.rgb('--color-accent')") && s26.includes("Deck.rgb('--color-text')"));
  const s45 = s.find((x) => x.id === 's45-ffn-recap').html;
  assert.ok(s45.includes("'var(--color-text-faint)'"), 's45 ghost arrow follows the theme');
});

test('the sampling board: larger readout, and reader interaction cancels pending temperature resends', { skip: !HAVE_DECK }, () => {
  const s53 = extractSlides(deck()).find((x) => x.id === 's53-sampling-board').html;
  assert.ok(s53.includes('[data-readout]{font-size:28px'), 'readout enlarged inside the board document');
  assert.ok(s53.includes("['pointerdown', 'pointermove', 'keydown', 'wheel']"), 'reader interaction cancels the burst timers');
});

test('s34 describes the key as the influence a token has to offer (review)', { skip: !HAVE_DECK }, () => {
  const s34 = extractSlides(deck()).find((x) => x.id === 's34-key').html;
  assert.ok(s34.includes('Embedding × Wk = key: what influence this token has to offer.'));
});
