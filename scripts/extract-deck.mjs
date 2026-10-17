#!/usr/bin/env node
// Lift the slides of the "Why Transformers Actually Work" talk (deck.html) into
// per-slide HTML files the blog can inline, plus a manifest of steps and notes.
//
// Each slide is kept verbatim (markup, id-scoped <style>, inline <script>) except:
// - its speaker notes move from <aside class="notes"> into the manifest;
// - viewport units in its CSS become pixels of the fixed 1280x720 design frame
//   every figure renders at (the frame is then scaled to fit the article);
// - any style rule not scoped to the slide's id gets scoped to it.
//
// Usage: node scripts/extract-deck.mjs <deck.html> [outDir]
//   outDir defaults to src/components/illustrations/deck

import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const FRAME_W = 1280;
export const FRAME_H = 720;

const PX_PER_UNIT = {
  vw: FRAME_W / 100, vmax: FRAME_W / 100,
  vh: FRAME_H / 100, dvh: FRAME_H / 100, svh: FRAME_H / 100, lvh: FRAME_H / 100, vmin: FRAME_H / 100,
};

const round = (x) => String(Math.round(x * 100) / 100);

/** Viewport units -> pixels of the 1280x720 frame (1vw = 12.8px, 1vh = 7.2px). */
export function rewriteViewportUnits(css) {
  return css.replace(/(?<![A-Za-z_])(-?\d*\.?\d+)(dvh|svh|lvh|vmin|vmax|vw|vh)\b/g,
    (_, n, unit) => round(parseFloat(n) * PX_PER_UNIT[unit]) + 'px');
}

// ---- tiny CSS walker: enough for the deck's hand-written slide styles ----

function matchBrace(css, open) {
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}' && --depth === 0) return i;
  }
  throw new Error('unbalanced braces in slide CSS');
}

function splitSelectorList(prelude) {
  const out = [];
  let depth = 0, cur = '';
  for (const ch of prelude) {
    if (ch === '(' || ch === '[') depth++;
    if (ch === ')' || ch === ']') depth--;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

/** Calls fn(selector) for every style-rule selector (inside @media/@supports too) and
 *  returns the CSS rebuilt with fn's return values; a null return drops the selector, and
 *  a rule left with no selectors is dropped. Comments are dropped too. */
function mapSelectors(css, fn) {
  css = css.replace(/\/\*[\s\S]*?\*\//g, '');
  let out = '', i = 0;
  while (i < css.length) {
    const open = css.indexOf('{', i);
    if (open === -1) { out += css.slice(i); break; }
    const prelude = css.slice(i, open);
    const close = matchBrace(css, open);
    const body = css.slice(open + 1, close);
    const p = prelude.trim();
    if (/^@(media|supports|container|layer)\b/.test(p)) out += prelude + '{' + mapSelectors(body, fn) + '}';
    else if (p.startsWith('@')) out += prelude + '{' + body + '}';
    else {
      const sels = splitSelectorList(p).map(fn).filter((s) => s != null);
      if (sels.length) out += prelude.match(/^\s*/)[0] + sels.join(', ') + '{' + body + '}';
    }
    i = close + 1;
  }
  return out;
}

const isScoped = (sel, id) => sel === '#' + id || new RegExp('^#' + id + '[\\s.:\\[>+~]').test(sel);

// The sampling board embeds a whole document in srcdoc="..."; its CSS belongs to that
// iframe (its own viewport, its own scope), so it is shielded from every rewrite here.
function shieldSrcdoc(html) {
  const saved = [];
  const shielded = html.replace(/srcdoc="[^"]*"/g, (m) => { saved.push(m); return `srcdoc="\u0000${saved.length - 1}\u0000"`; });
  return { shielded, restore: (s) => s.replace(/srcdoc="\u0000(\d+)\u0000"/g, (_, k) => saved[+k]) };
}

const styleBlocks = (html) => [...shieldSrcdoc(html).shielded.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]);

/** Selectors in a slide's own <style> blocks that are not scoped to its id. */
export function unscopedSelectors(slide) {
  const bad = [];
  for (const css of styleBlocks(slide.html)) mapSelectors(css, (sel) => { if (!isScoped(sel, slide.id)) bad.push(sel); return sel; });
  return bad;
}

/** The deck's shared styles (type, primitives, slide layout, step reveal, terminal) scoped under
 *  `.dk .dk-frame` with viewport units rewritten. Its page-level rules (html, body, .deck) and
 *  the presenter chrome (progress bar, dots, notes...) stay behind. */
export function extractBaseCss(html) {
  const start = html.indexOf('/* ============ TYPE ============ */');
  const end = html.indexOf('</style>', start);
  if (start < 0 || end < 0) throw new Error('deck base CSS markers not found');
  const css = rewriteViewportUnits(html.slice(start, end).replace(/\/\* chrome \*\/[\s\S]*?(?=\/\* terminal)/, ''));
  const scope = (sel) => (/^(html|body)\b/.test(sel) || sel === '.deck' ? null : `.dk .dk-frame ${sel}`);
  return mapSelectors(css, scope).replace(/\n\s*\n+/g, '\n').trim() + '\n';
}

/* Slide-specific adaptations to the article's scaled frame. Each [old, new] must match once. */
const FIXUPS = {
  // positions its tags from getBoundingClientRect deltas, which the frame's CSS scale shrinks
  's15-model-folder': [
    ['var t0 = term.getBoundingClientRect().top;', 'var t0 = term.getBoundingClientRect().top, k = Deck.scale(term);'],
    ['(a.top - t0).toFixed(1)', '((a.top - t0) / k).toFixed(1)'],
    ['(b.bottom - a.top).toFixed(1)', '((b.bottom - a.top) / k).toFixed(1)'],
  ],
  // Usman's review: the key is the influence a token has to offer
  's34-key': [
    ['Embedding × Wk = key: what this token has to offer.', 'Embedding × Wk = key: what influence this token has to offer.'],
  ],
  // its grey ghost arrow is coloured once, with the dark theme's faint text colour
  's45-ffn-recap': [
    ["setArrow(ghost, X0, 4, '#4a4a52');", "setArrow(ghost, X0, 4, '#4a4a52'); ghost.sh.style.stroke = ghost.hd.style.fill = 'var(--color-text-faint)';"],
  ],
  's53-sampling-board': [
    // the readout ("T 1.00 · mat 42%") is read in the prose: readable once the frame is scaled down
    ['.embed .iso-legend{display:none}', '.embed .iso-legend{display:none} .iso-plate-corner{font-size:18px!important} .iso-plate-corner[data-readout]{font-size:28px!important}'],
    // once the reader drives the knob, the step's pending temperature resends must not override it
    ["frame.addEventListener('load', burst);",
      "frame.addEventListener('load', function () {\n            burst();\n            var w = frame.contentWindow;\n            ['pointerdown', 'pointermove', 'keydown', 'wheel'].forEach(function (t) { w.addEventListener(t, function () { timers.forEach(clearTimeout); }, { passive: true }); });\n          });"],
  ],
};

/* Slide scripts interpolate colours from RGB triples of the dark theme's tokens. Each becomes a
   live Deck.rgb() array that follows the site theme. */
const TOKEN_RGB = {
  '34,211,238': '--color-accent', '237,237,240': '--color-text', '196,196,203': '--color-text-soft',
  '154,154,163': '--color-text-muted', '106,106,115': '--color-text-dim', '74,74,82': '--color-text-faint',
};
function liveColors(js) {
  return js.replace(/\[\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\]/g, (m, r, g, b) => {
    const token = TOKEN_RGB[`${r},${g},${b}`];
    return token ? `Deck.rgb('${token}')` : m;
  });
}

function applyFixups(id, html) {
  for (const [from, to] of FIXUPS[id] || []) {
    const n = html.split(from).length - 1;
    if (n !== 1) throw new Error(`fixup for ${id} matched ${n} times: ${from}`);
    html = html.replace(from, to);
  }
  return html;
}

const text = (s) => s.replace(/<br\s*\/?>/g, ' ').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

/** All slides of the deck, in order, ready to inline. */
export function extractSlides(html) {
  const lines = html.split('\n');
  const slides = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith('<section class="slide"')) continue;
    let j = i + 1;
    while (j < lines.length && lines[j] !== '</section>') j++;
    if (j === lines.length) throw new Error(`slide at line ${i + 1} never closes`);
    const raw = lines.slice(i, j + 1).join('\n');
    const attr = (name) => (lines[i].match(new RegExp(`${name}="([^"]*)"`)) || [])[1];
    const id = attr('id');
    const notesM = raw.match(/\n?[ \t]*<aside class="notes">([\s\S]*?)<\/aside>/);
    let body = notesM ? raw.replace(notesM[0], '') : raw;

    const { shielded, restore } = shieldSrcdoc(body);
    let out = shielded
      .replace(/<style>([\s\S]*?)<\/style>/g, (_, css) =>
        '<style>' + mapSelectors(rewriteViewportUnits(css), (sel) => (isScoped(sel, id) ? sel : `#${id} ${sel}`)) + '</style>')
      .replace(/style="([^"]*)"/g, (_, css) => `style="${rewriteViewportUnits(css)}"`)
      .replace(/<script>([\s\S]*?)<\/script>/g, (_, js) => '<script>' + liveColors(js) + '</script>');
    body = applyFixups(id, restore(out));

    slides.push({
      id,
      steps: Number(attr('data-steps') || 0),
      tool: attr('data-tool') || null,
      kicker: text((raw.match(/<p class="kicker[^"]*">([\s\S]*?)<\/p>/) || [, ''])[1]),
      statement: text((raw.match(/<p class="statement[^"]*">([\s\S]*?)<\/p>/) || [, ''])[1]),
      notes: notesM ? text(notesM[1]) : '',
      html: body,
    });
    i = j;
  }
  return slides;
}

function main(deckPath, outDir) {
  const html = readFileSync(deckPath, 'utf8');
  writeFileSync(join(outDir, 'deck-base.css'),
    '/* Generated by scripts/extract-deck.mjs from the talk deck: do not edit by hand. */\n' + extractBaseCss(html));
  const slides = extractSlides(html).filter((s) => !s.id.startsWith('s01-'));
  const dir = join(outDir, 'slides');
  mkdirSync(dir, { recursive: true });
  for (const f of readdirSync(dir)) if (/^s\d\d-.*\.html$/.test(f)) rmSync(join(dir, f));
  const manifest = {};
  for (const s of slides) {
    writeFileSync(join(dir, `${s.id}.html`), s.html + '\n');
    manifest[s.id] = { steps: s.steps, tool: s.tool, kicker: s.kicker, statement: s.statement, notes: s.notes };
  }
  writeFileSync(join(outDir, 'slides.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`wrote ${slides.length} slides to ${dir}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [deckPath, outDir = 'src/components/illustrations/deck'] = process.argv.slice(2);
  if (!deckPath) { console.error('usage: node scripts/extract-deck.mjs <deck.html> [outDir]'); process.exit(2); }
  main(deckPath, outDir);
}
