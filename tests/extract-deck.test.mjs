import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractSlides, rewriteViewportUnits, unscopedSelectors, extractBaseCss, isDecorative, main } from '../scripts/extract-deck.mjs';

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

test('isDecorative marks covers, about-me and title slides', () => {
  const decorative = [
    's01-cover', 's01-me', 's01-title-refresher', 's11-title-dissecting',
    't001-cover', 't100-title-finetuning', 't200-title-reasoning',
    't300-title-alignment', 't400-title-moe', 't500-title-gpu',
    't600-title-kvcache', 't700-title-quantization',
  ];
  for (const id of decorative) {
    assert.equal(isDecorative(id), true, `${id} should be decorative`);
  }
  const nonDecorative = ['s02-vec2d', 's11-sandstone', 't101-base-continues', 'x01-trainpass'];
  for (const id of nonDecorative) {
    assert.equal(isDecorative(id), false, `${id} should not be decorative`);
  }
});

test('a fixup whose slide is missing from the deck is an error', () => {
  assert.throws(() => extractSlides('<section class="slide" id="s99-x">\n</section>'), /fixup target s15-model-folder is not in the deck/);
});

test('extractSlides finds all 123 slides of both parts', { skip: !HAVE_DECK }, () => {
  const s = extractSlides(deck());
  assert.equal(s.length, 123);
  assert.equal(s[0].id, 's01-cover');
  assert.equal(s.at(-1).id, 't709-native-support');
  const s30 = s.find((x) => x.id === 's30-ball-3d');
  assert.equal(s30.steps, 4);
  assert.match(s30.notes, /^SAY: golf ball/);
  assert.equal(s30.statement, 'Each ball is the same vector, transformed in a different direction.');
  const t406 = s.find((x) => x.id === 't406-top2');
  assert.equal(t406.steps, 4);
  const t606 = s.find((x) => x.id === 't606-kv-memory');
  assert.equal(t606.statement, 'The cache is why inference eats memory.');
  assert.ok(s.every((x) => !x.html.includes('<iframe')));
  assert.equal(s.filter((x) => !isDecorative(x.id)).length, 111);
});

test('main writes the non-decorative slides and keeps hand-authored ones', { skip: !HAVE_DECK }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'deck-extract-test-'));
  try {
    const slidesDir = join(dir, 'slides');
    mkdirSync(slidesDir, { recursive: true });
    writeFileSync(join(slidesDir, 's04-vec-many.html'), 'pre-seeded');
    writeFileSync(join(slidesDir, 'x01-trainpass.html'), 'hand-authored');

    main('deck.html', dir);

    assert.equal(existsSync(join(slidesDir, 's04-vec-many.html')), false, 'pre-seeded s04 should be removed');
    assert.equal(existsSync(join(slidesDir, 'x01-trainpass.html')), true, 'x01-trainpass should be kept');
    assert.equal(existsSync(join(slidesDir, 't709-native-support.html')), true, 't709-native-support should exist');
    assert.equal(existsSync(join(slidesDir, 's41-wu-wd-intro.html')), true, 's41-wu-wd-intro should exist');
    assert.equal(existsSync(join(slidesDir, 's01-cover.html')), false, 'decorative s01-cover should not exist');
    assert.equal(existsSync(join(slidesDir, 't100-title-finetuning.html')), false, 'decorative t100-title-finetuning should not exist');

    const manifest = JSON.parse(readFileSync(join(dir, 'slides.json'), 'utf8'));
    assert.equal(Object.keys(manifest).length, 111);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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
  const s = extractSlides(deck()).filter((x) => !isDecorative(x.id));
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
  const s = extractSlides(deck()).filter((x) => !isDecorative(x.id));
  const left = s.filter((x) => TOKEN_TRIPLES.test(x.html.replace(/srcdoc="[^"]*"/g, ''))).map((x) => x.id);
  assert.deepEqual(left, []);
  const s26 = s.find((x) => x.id === 's26-nudge-all').html;
  assert.ok(s26.includes("Deck.rgb('--color-accent')") && s26.includes("Deck.rgb('--color-text')"));
  const s45 = s.find((x) => x.id === 's45-ffn-recap').html;
  assert.ok(s45.includes("'var(--color-text-faint)'"), 's45 ghost arrow follows the theme');
});

test('s34 says "what kind of influence" in the deck itself', { skip: !HAVE_DECK }, () => {
  const s34 = extractSlides(deck()).find((x) => x.id === 's34-key').html;
  assert.ok(s34.includes('Embedding × Wk = key: what kind of influence this token has to offer.'));
});

test('t706 shows llama.cpp\'s Q4_K bits per weight', { skip: !HAVE_DECK }, () => {
  const t706 = extractSlides(deck()).find((x) => x.id === 't706-block-scales').html;
  assert.ok(t706.includes("'~4.9 bits'"), 't706 on-screen label has ~4.9 bits');
  assert.ok(t706.includes("'~4.7 bits'"), 't706 on-screen label has ~4.7 bits');
  assert.ok(t706.includes('about 4.9 bits per weight for Q4_K_M'), 't706 desc has 4.9 bits');
  assert.ok(!t706.includes("'~4.5 bits'"), 't706 does not include ~4.5 bits');
  assert.ok(!t706.includes("'~4 bits'"), 't706 does not include ~4 bits');
});

test('t106 uses theme tokens for switch values', { skip: !HAVE_DECK }, () => {
  const t106 = extractSlides(deck()).find((x) => x.id === 't106-template-knobs').html;
  assert.ok(t106.includes("w.v.style.fill = f > 0.5 ? 'var(--color-accent)' : 'var(--color-text-muted)';"), 't106 uses theme vars for switch value fill');
  assert.ok(!t106.includes("w.v.style.fill = f > 0.5 ? 'rgb(34,211,238)' : 'rgb(154,154,163)';"), 't106 does not hard-code switch value rgb');
});

test('t405 uses theme tokens for scores and winner headers', { skip: !HAVE_DECK }, () => {
  const t405 = extractSlides(deck()).find((x) => x.id === 't405-router-scores').html;
  assert.ok(t405.includes("snum[k].style.fill = top ? 'var(--color-accent)' : 'var(--color-text-muted)';"), 't405 uses theme vars for score fill');
  assert.ok(t405.includes("heads[k].style.fill = (top && a > 0.5) ? 'var(--color-accent)' : '';"), 't405 uses theme vars for winner header fill');
  assert.ok(!t405.includes("snum[k].style.fill = top ? 'rgb(34,211,238)' : 'rgb(196,196,203)';"), 't405 does not hard-code score rgb');
});

test('t606 uses color-bg for request block labels so it counts as knockout text', { skip: !HAVE_DECK }, () => {
  const t606 = extractSlides(deck()).find((x) => x.id === 't606-kv-memory').html;
  assert.ok(t606.includes('.rql{font-size:22px;text-anchor:middle;fill:var(--color-bg);font-weight:700;}'), 't606 uses color-bg for rql fill');
  assert.ok(!t606.includes('.rql{font-size:22px;text-anchor:middle;fill:var(--color-surface-deep);font-weight:700;}'), 't606 does not use surface-deep for rql fill');
});

test('t607 uses Deck.loop inside enter for pipe animation', { skip: !HAVE_DECK }, () => {
  const t607 = extractSlides(deck()).find((x) => x.id === 't607-prefill-vs-decode').html;
  assert.ok(t607.includes('stopPipe = Deck.loop(animatePipe);'), 't607 uses Deck.loop inside enter');
  assert.ok(!t607.includes('function runPipe()'), 't607 does not define runPipe with raw rAF');
});


