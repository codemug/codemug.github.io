#!/usr/bin/env node
// Browser QA for the deck figures (figure.dk) on one page.
//
// Usage: node scripts/qa/deck-check.mjs <url> [--reduced] [--shots] [--only=a,b]
//   default   : states, stress, autoplay-in-view, expand at 360px, off-screen rAF
//   --reduced : no figure may advance by itself under prefers-reduced-motion
//   --shots   : screenshot every state at 360/768/1280 px into /tmp/deck-qa/
//
// Needs Playwright, which is not a repo dependency: set PLAYWRIGHT_MODULE to its
// path, or keep the sibling install at ../immigration/career-ops/node_modules/playwright.

import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || resolve(repo, '../immigration/career-ops/node_modules/playwright'));

const args = process.argv.slice(2);
const url = args.find((a) => !a.startsWith('--'));
const REDUCED = args.includes('--reduced');
const SHOTS = args.includes('--shots');
const ONLY = (args.find((a) => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);
if (!url) { console.error('usage: deck-check.mjs <url> [--reduced] [--shots] [--only=a,b]'); process.exit(2); }

const failures = [];
const fail = (who, msg) => failures.push(`${who}: ${msg}`);
const browser = await chromium.launch();

async function open(viewport, reduced = false) {
  const ctx = await browser.newContext({ viewport, reducedMotion: reduced ? 'reduce' : 'no-preference' });
  // count animation frames requested anywhere on the page, iframes included
  await ctx.addInitScript(() => {
    const orig = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) => { try { window.top.__dkRaf = (window.top.__dkRaf || 0) + 1; } catch {} return orig(cb); };
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  // errors from our own page count; third-party requests (analytics beacon, comments) do not
  const thirdParty = (t) => (t.match(/https?:\/\/[^\s'"]+/g) || []).some((u) => !/^https?:\/\/(localhost|127\.0\.0\.1)/.test(u));
  page.on('console', (m) => {
    if (m.type() === 'error' && /localhost|127\.0\.0\.1/.test(m.location().url || '') && !thirdParty(m.text())) errors.push(m.text());
  });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(800);
  return { ctx, page, errors };
}

const figSel = (name) => `figure.dk[data-fig="${name}"]`;
// the figure's states: [slide index, step] for every step it shows (all steps, or the picked ones)
const flatStates = (f) => f.slides.flatMap((s, i) => (s.picks || Array.from({ length: s.n + 1 }, (_, n) => n)).map((n) => [i, n]));
const readState = (page, sel) => page.$eval(sel, (f) => +f.dataset.state);

async function figures(page) {
  const all = await page.$$eval('figure.dk', (els) => els.map((f) => ({
    name: f.dataset.fig,
    slides: [...f.querySelectorAll('.dk-frame > .slide')].map((s) => ({
      n: +s.getAttribute('data-steps') || 0,
      picks: s.getAttribute('data-dk-steps') ? s.getAttribute('data-dk-steps').split(',').map(Number) : null,
    })),
  })));
  return ONLY.length ? all.filter((f) => ONLY.includes(f.name)) : all;
}

async function rewind(page, sel, max) {
  for (let k = 0; k <= max && (await readState(page, sel)) !== 0; k++) await page.click(`${sel} .dk-prev`);
}

async function walk(page, f, shotDir) {
  const sel = figSel(f.name);
  const flat = flatStates(f);
  await page.locator(sel).scrollIntoViewIfNeeded();
  // stop autoplay first, so only our clicks move the figure
  if ((await page.getAttribute(`${sel} .dk-play`, 'aria-label')) === 'Pause') await page.click(`${sel} .dk-play`);
  await rewind(page, sel, flat.length + 2);
  for (let k = 0; k < flat.length; k++) {
    if (k > 0) await page.click(`${sel} .dk-next`);
    await page.waitForTimeout(shotDir ? 1100 : 150);
    const info = await page.$eval(sel, (fig) => {
      const vis = [...fig.querySelectorAll('.dk-frame > .slide.visible')];
      return { vis: vis.length, cur: vis[0] && vis[0].getAttribute('data-cur'), state: +fig.dataset.state,
        now: [...fig.querySelectorAll('.dk-pips i')].findIndex((i) => i.classList.contains('now')) };
    });
    if (info.vis !== 1) fail(f.name, `state ${k}: ${info.vis} visible slides`);
    if (info.state !== k || info.now !== k) fail(f.name, `state ${k}: data-state ${info.state}, pip ${info.now}`);
    if (Number(info.cur) !== flat[k][1]) fail(f.name, `state ${k}: data-cur ${info.cur}, want ${flat[k][1]}`);
    if (shotDir) await page.locator(sel).screenshot({ path: `${shotDir}/${f.name}-${String(k).padStart(2, '0')}.png` });
  }
  return flat.length;
}

if (REDUCED) {
  const { ctx, page, errors } = await open({ width: 1280, height: 900 }, true);
  const figs = await figures(page);
  if (!figs.length) failures.push('no figure.dk on the page');
  for (const f of figs) {
    const sel = figSel(f.name);
    await page.locator(sel).scrollIntoViewIfNeeded();
    const before = await readState(page, sel);
    await page.waitForTimeout(3500);
    const after = await readState(page, sel);
    if (after !== before) fail(f.name, `advanced by itself under reduced motion (${before} -> ${after})`);
  }
  errors.forEach((e) => failures.push('page error: ' + e));
  await ctx.close();
} else {
  const { ctx, page, errors } = await open({ width: 1280, height: 900 });
  const figs = await figures(page);
  if (!figs.length) failures.push('no figure.dk on the page');
  for (const f of figs) {
    const sel = figSel(f.name);
    const states = flatStates(f).length;
    const pips = await page.$$eval(`${sel} .dk-pips i`, (x) => x.length);
    if (pips !== states) fail(f.name, `pips ${pips} != states ${states}`);

    // autoplay starts once the figure is in view (first advance after the figure's own dwell)
    await page.locator(sel).scrollIntoViewIfNeeded();
    const s0 = await readState(page, sel);
    const { dwell, embed } = await page.$eval(sel, (fig) => ({ dwell: +fig.dataset.dwell || 2800, embed: !!fig.querySelector('iframe[data-dk-srcdoc]') }));
    if (!embed) { // figures with an embedded interactive document never autoplay (checked below)
      await page.waitForTimeout(dwell + 1500);
      if (states > 1 && (await readState(page, sel)) === s0) fail(f.name, 'did not autoplay while in view');
    }

    await walk(page, f);

    // stress: interrupt tweens with rapid clicks in both directions
    for (let k = 0; k < 20; k++) await page.click(`${sel} .dk-next`);
    for (let k = 0; k < 20; k++) await page.click(`${sel} .dk-prev`);
    await page.waitForTimeout(700);
    const after = await page.$eval(sel, (fig) => ({ vis: fig.querySelectorAll('.dk-frame > .slide.visible').length, state: +fig.dataset.state }));
    if (after.vis !== 1 || after.state !== 0) fail(f.name, `after rapid clicks: ${after.vis} visible slides, state ${after.state}`);
  }

  // off-screen figures must not request animation frames
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(1500);
  await page.evaluate(() => { window.__dkRaf = 0; });
  await page.waitForTimeout(2000);
  const raf = await page.evaluate(() => window.__dkRaf);
  if (raf >= 5) failures.push(`off-screen: ${raf} animation frames requested in 2 s with every figure scrolled away`);
  errors.forEach((e) => failures.push('page error: ' + e));
  await ctx.close();

  // expand: the figure exactly covers the viewport, on top of everything (header included),
  // its close button is on screen, Esc restores it; on phones it never shrinks below 0.5
  for (const vp of [{ width: 360, height: 740 }, { width: 1280, height: 900 }]) {
    const m = await open(vp);
    const first = (await figures(m.page))[0];
    if (first) {
      const sel = figSel(first.name);
      const tag = `${first.name} @${vp.width}`;
      await m.page.locator(sel).scrollIntoViewIfNeeded();
      if (vp.width === 360) {
        const bar = await m.page.locator(`${sel} .dk-bar`).boundingBox();
        if (!bar || bar.x < 0 || bar.x + bar.width > 361) fail(tag, `controls off screen: ${JSON.stringify(bar)}`);
        // slides are centred compositions: an overflowing stage starts scrolled to its middle
        const sc = await m.page.$eval(`${sel} .dk-scroll`, (s) => ({ left: s.scrollLeft, mid: (s.scrollWidth - s.clientWidth) / 2 }));
        if (sc.mid > 0 && Math.abs(sc.left - sc.mid) > 2) fail(tag, `stage not centred: scrollLeft ${sc.left}, middle ${sc.mid}`);
      }
      await m.page.click(`${sel} .dk-expand`);
      await m.page.waitForTimeout(500);
      const got = await m.page.$eval(sel, (f) => {
        const r = f.getBoundingClientRect(), b = f.querySelector('.dk-expand').getBoundingClientRect();
        const top = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
        return { expanded: f.classList.contains('is-expanded'), r: [r.x, r.y, r.width, r.height].map(Math.round),
          btn: [b.x, b.y, b.right, b.bottom].map(Math.round), onTop: !!top && f.contains(top),
          scale: parseFloat(getComputedStyle(f).getPropertyValue('--dk-scale')), W: innerWidth, H: innerHeight };
      });
      const [x, y, w, h] = got.r;
      if (!got.expanded || Math.abs(x) > 2 || Math.abs(y) > 2 || Math.abs(w - got.W) > 2 || Math.abs(h - got.H) > 2) fail(tag, `expanded figure does not cover the viewport: ${JSON.stringify(got.r)} vs ${got.W}x${got.H}`);
      if (got.btn[0] < 0 || got.btn[1] < 0 || got.btn[2] > got.W || got.btn[3] > got.H) fail(tag, `close button off screen: ${JSON.stringify(got.btn)}`);
      if (!got.onTop) fail(tag, 'expanded figure is not the topmost element at the screen centre');
      if (vp.width === 360 && got.scale < 0.5) fail(tag, `expanded scale ${got.scale} is smaller than the inline 0.5`);
      await m.page.keyboard.press('Escape');
      await m.page.waitForTimeout(300);
      if (await m.page.$eval(sel, (f) => f.classList.contains('is-expanded'))) fail(tag, 'Esc did not close expand');
    }
    m.errors.forEach((e) => failures.push(`page error (${vp.width}px): ` + e));
    await m.ctx.close();
  }

  // light theme: no visible text in any state may fall under 2:1 contrast against the page
  const L = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: 'light', reducedMotion: 'reduce' });
  const lp = await L.newPage();
  await lp.goto(url, { waitUntil: 'load' });
  await lp.waitForTimeout(800);
  for (const f of await figures(lp)) {
    const sel = figSel(f.name);
    const states = flatStates(f).length;
    await lp.locator(sel).scrollIntoViewIfNeeded();
    if ((await lp.getAttribute(`${sel} .dk-play`, 'aria-label')) === 'Pause') await lp.click(`${sel} .dk-play`);
    await rewind(lp, sel, states + 2);
    for (let k = 0; k < states; k++) {
      if (k > 0) await lp.click(`${sel} .dk-next`);
      await lp.waitForTimeout(80);
      const low = await lp.$eval(sel, (fig) => {
        const lum = (c) => { const m = (c.match(/[\d.]+/g) || [0, 0, 0]).slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]; };
        const bgColor = getComputedStyle(fig).backgroundColor;
        const bg = lum(bgColor);
        const slide = fig.querySelector('.dk-frame > .slide.visible');
        const out = [];
        slide.querySelectorAll('text, tspan, span, p, div, b, i, em, strong, td, th, li, code').forEach((el) => {
          const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
          if (!own || el.closest('.kicker')) return;
          let op = 1;
          for (let p = el; p && p !== fig; p = p.parentElement) { const cs = getComputedStyle(p); if (cs.display === 'none' || cs.visibility === 'hidden') return; op *= parseFloat(cs.opacity); }
          if (op < 0.35) return;
          const cs = getComputedStyle(el);
          const col = el instanceof SVGElement ? cs.fill : cs.color;
          if (!/^rgb/.test(col)) return;
          if (col === bgColor) return; // a knockout label, drawn in the page colour on a filled shape
          const a = lum(col), ratio = (Math.max(a, bg) + 0.05) / (Math.min(a, bg) + 0.05);
          if (ratio < 2) out.push(`"${el.textContent.trim().slice(0, 24)}" ${col} ${ratio.toFixed(2)}:1`);
        });
        return out;
      });
      if (low.length) { fail(f.name, `light theme, state ${k}: ${low.length} low-contrast texts, e.g. ${low.slice(0, 3).join('; ')}`); break; }
    }
  }
  await L.close();

  // embedded interactive documents (the sampling board): the reader drives them
  const bp = await open({ width: 768, height: 900 });
  const boards = await bp.page.$$eval('figure.dk', (els) => els.filter((f) => f.querySelector('iframe[data-dk-srcdoc]')).map((f) => f.dataset.fig));
  for (const name of boards) {
    const sel = figSel(name);
    await bp.page.locator(sel).scrollIntoViewIfNeeded();
    const s0 = await readState(bp.page, sel);
    await bp.page.waitForTimeout(5000);
    if ((await readState(bp.page, sel)) !== s0) fail(name, 'a figure with an embedded interactive document must not autoplay');
    const frame = bp.page.frameLocator(`${sel} iframe`);
    const ro = await frame.locator('[data-readout]').boundingBox();
    if (!ro || ro.height < 11) fail(name, `readout too small at 768px: ${ro && ro.height.toFixed(1)}px tall`);
    await frame.locator('.iso-stage').dispatchEvent('pointerdown');
    await bp.page.waitForTimeout(200);
    if (!(await bp.page.$eval(sel, (f) => f.__dk && f.__dk.touched && !f.__dk.playing))) fail(name, 'reader interaction inside the board did not take over from the player');
  }
  bp.errors.forEach((e) => failures.push('page error (board): ' + e));
  await bp.ctx.close();

  // theme: embedded documents (the sampling board) follow the site theme, both ways, with no
  // backdrop of their own (their body stays transparent and their color-scheme matches)
  const t = await open({ width: 1280, height: 900 });
  const withFrame = await t.page.$$eval('figure.dk', (els) => els.filter((f) => f.querySelector('iframe[data-dk-srcdoc]')).map((f) => f.dataset.fig));
  for (const name of withFrame) {
    const sel = figSel(name);
    await t.page.locator(sel).scrollIntoViewIfNeeded();
    await t.page.waitForTimeout(2500);
    for (const theme of ['light', 'dark', 'light']) {
      await t.page.evaluate((th) => { if (th === 'light') document.documentElement.setAttribute('data-theme', 'light'); else document.documentElement.removeAttribute('data-theme'); }, theme);
      await t.page.waitForTimeout(300);
      const got = await t.page.$eval(`${sel} iframe`, (f) => {
        const d = f.contentDocument;
        if (!d || !d.body) return null;
        return { theme: d.body.getAttribute('data-theme'), scheme: getComputedStyle(d.documentElement).colorScheme,
          frameScheme: getComputedStyle(f).colorScheme, bg: getComputedStyle(d.body).backgroundColor };
      });
      if (!got) { fail(name, `theme ${theme}: embedded document not loaded`); break; }
      if (got.theme !== theme || got.scheme !== theme || got.frameScheme !== theme) fail(name, `theme ${theme}: embedded document reports ${JSON.stringify(got)}`);
      if (got.bg !== 'rgba(0, 0, 0, 0)') fail(name, `theme ${theme}: embedded body paints its own background ${got.bg}`);
    }
  }
  t.errors.forEach((e) => failures.push('page error (theme): ' + e));
  await t.ctx.close();

  if (SHOTS) {
    for (const width of [1280, 768, 360]) {
      const dir = `/tmp/deck-qa/${width}`;
      mkdirSync(dir, { recursive: true });
      const s = await open({ width, height: 900 });
      for (const f of await figures(s.page)) await walk(s.page, f, dir);
      await s.ctx.close();
    }
    console.log('screenshots in /tmp/deck-qa/');
  }
}

await browser.close();
if (failures.length) {
  console.log(`FAIL (${failures.length})`);
  failures.forEach((f) => console.log('  - ' + f));
  process.exit(1);
}
console.log('PASS: deck figures');
