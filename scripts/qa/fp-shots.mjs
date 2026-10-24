#!/usr/bin/env node
// BEFORE-baseline screenshots of the FramePlayer figures (figure.fp) on one page.
//
// Usage: node scripts/qa/fp-shots.mjs <url> <outDir>
//   <url> is a full http(s) URL or a path (served from http://localhost:4323).
//   Loads the page with reduced motion (no autoplay, no CSS transitions), and for
//   every figure.fp, in page order, clicks each .fp-dot in turn, waits 400 ms,
//   and saves an element screenshot of the figure to <outDir>/<i>-<k>.png
//   (i = figure index from 1, k = frame number). Prints the number of screenshots.
//   Exits non-zero if a figure's data-frame does not follow the clicked dot.
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
const [urlArg, outDir] = args;
if (!urlArg || !outDir) { console.error('usage: fp-shots.mjs <url> <outDir>'); process.exit(2); }
const url = /^https?:/.test(urlArg) ? urlArg : `http://localhost:4323${urlArg.startsWith('/') ? '' : '/'}${urlArg}`;
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
const page = await ctx.newPage();
await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(800); // let the inline runtime init every .fp

const figs = await page.$$('figure.fp');
if (!figs.length) { console.error(`no figure.fp on ${url}`); await browser.close(); process.exit(1); }

let shots = 0;
for (let i = 1; i <= figs.length; i++) {
  const fig = figs[i - 1];
  const name = (await fig.getAttribute('class')) || '';
  const dots = await fig.$$('.fp-dot');
  if (!dots.length) { console.error(`figure ${i} (${name}): no .fp-dot, player not initialised`); await browser.close(); process.exit(1); }
  for (let k = 1; k <= dots.length; k++) {
    await dots[k - 1].click();
    await page.waitForTimeout(400);
    if ((await fig.getAttribute('data-frame')) !== String(k)) {
      console.error(`figure ${i} (${name}): data-frame is ${await fig.getAttribute('data-frame')} after clicking dot ${k}`);
      await browser.close();
      process.exit(1);
    }
    await fig.screenshot({ path: `${outDir}/${i}-${k}.png` });
    shots++;
  }
  console.log(`figure ${i} (${name}): ${dots.length} frames`);
}

await ctx.close();
await browser.close();
console.log(`${shots} screenshots of ${figs.length} figures in ${outDir}`);
