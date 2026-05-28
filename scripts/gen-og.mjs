// Generate public/og-image.png from scripts/og-template.html using Playwright.
// Run from the parent career-ops directory (which has Playwright installed):
//   cd .. && node cv/scripts/gen-og.mjs
//
// Output: cv/public/og-image.png (1200x630, ready for Open Graph cards).

import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const templatePath = resolve(__dirname, "og-template.html");
const outputPath = resolve(__dirname, "..", "public", "og-image.png");

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1200, height: 630 },
  deviceScaleFactor: 1,
});
const page = await ctx.newPage();
await page.goto(`file://${templatePath}`);
await page.waitForLoadState("networkidle");
await page.screenshot({ path: outputPath, type: "png", omitBackground: false });
await browser.close();

console.log(`✓ wrote ${outputPath}`);
