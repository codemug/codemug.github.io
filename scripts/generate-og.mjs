// Generates a branded Open Graph card (1200x630 PNG) per blog post, so links
// unfurl with a title card instead of the site profile image. Run locally with
// `npm run og` after adding or renaming a post; the PNGs are committed under
// public/og/ and served as static assets (no build-time generation, no CI font
// dependency). Uses sharp, which Astro already depends on.
import sharp from "sharp";
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const blogDir = join(root, "src/content/blog");
const outDir = join(root, "public/og");
mkdirSync(outDir, { recursive: true });

const esc = (s) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

function frontmatterTitle(src) {
  const fm = src.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fm) return null;
  const t = fm[1].match(/^title:\s*(.+?)\s*$/m);
  if (!t) return null;
  let v = t[1].trim();
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  )
    v = v.slice(1, -1);
  return v;
}

function wrap(text, max) {
  const words = text.split(/\s+/);
  const lines = [];
  let cur = "";
  for (const w of words) {
    const t = cur ? cur + " " + w : w;
    if (t.length > max && cur) {
      lines.push(cur);
      cur = w;
    } else cur = t;
  }
  if (cur) lines.push(cur);
  return lines;
}

// The card mirrors the site's dark theme + accent (see src/styles/global.css).
function cardSvg(title) {
  const [head, ...rest] = title.split(":");
  const headline = head.trim();
  const subtitle = rest.join(":").trim();

  let fs = 68,
    max = 23,
    lines = wrap(headline, max);
  if (lines.length > 2) {
    fs = 60;
    max = 30;
    lines = wrap(headline, max);
  }
  if (lines.length > 3) {
    fs = 52;
    max = 33;
    lines = wrap(headline, max);
  }
  if (lines.length > 4) {
    fs = 46;
    max = 38;
    lines = wrap(headline, max);
  }
  lines = lines.slice(0, 5);

  const lh = Math.round(fs * 1.14);
  const top = 250;
  const tspans = lines
    .map((l, i) => `<tspan x="82" y="${top + i * lh}">${esc(l)}</tspan>`)
    .join("");
  const subY = top + (lines.length - 1) * lh + 56;
  const sub = subtitle
    ? `<text x="82" y="${subY}" font-family="DejaVu Sans" font-size="30" fill="#6a6a73">${esc(subtitle)}</text>`
    : "";

  return `<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
<defs><radialGradient id="g" cx="14%" cy="6%" r="78%"><stop offset="0%" stop-color="#22d3ee" stop-opacity="0.13"/><stop offset="55%" stop-color="#22d3ee" stop-opacity="0"/></radialGradient></defs>
<rect width="1200" height="630" fill="#0a0a0b"/>
<rect width="1200" height="630" fill="url(#g)"/>
<rect width="1200" height="6" fill="#22d3ee"/>
<circle cx="84" cy="92" r="7" fill="#22d3ee"/>
<text x="104" y="100" font-family="DejaVu Sans" font-size="25" fill="#9a9aa3" letter-spacing="1.5">codemug.github.io</text>
<text font-family="DejaVu Sans" font-size="${fs}" font-weight="700" fill="#ededf0" letter-spacing="-1">${tspans}</text>
${sub}
<rect x="84" y="540" width="32" height="3" fill="#22d3ee"/>
<text x="84" y="582" font-family="DejaVu Sans" font-size="27" fill="#c4c4cb">Usman Shahid</text>
<text x="1116" y="582" text-anchor="end" font-family="DejaVu Sans" font-size="21" fill="#4a4a52">Staff SRE · Dubai</text>
</svg>`;
}

const files = readdirSync(blogDir).filter((f) => /\.mdx?$/.test(f));
let n = 0;
for (const f of files) {
  const slug = f.replace(/\.mdx?$/, "");
  const title = frontmatterTitle(readFileSync(join(blogDir, f), "utf8"));
  if (!title) {
    console.warn(`skip ${f}: no title`);
    continue;
  }
  const png = await sharp(Buffer.from(cardSvg(title))).png().toBuffer();
  writeFileSync(join(outDir, `${slug}.png`), png);
  console.log(`public/og/${slug}.png  ${Math.round(png.length / 1024)}KB`);
  n++;
}
console.log(`generated ${n} card(s)`);
