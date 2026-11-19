// Reproduce the unmodified upstream web release; never commit generated bundles.
import { mkdir, readFile, writeFile, access, rename, rm, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
const root = fileURLToPath(new URL('../../', import.meta.url));
const version = '11.5.0';
const digest = 'f6478925d3eaa16ec08626a85f5b85eed10d531a5e18700615fed7ecb024cccf';
const url = 'https://github.com/gchq/CyberChef/releases/download/v11.5.0/CyberChef_8cd426dd4f40f1423912d5fad91b578a86a65112.zip';
const cache = join(root, 'node_modules/.cache/webpc');
const output = join(root, 'public/pc/vendor/cyberchef');
const marker = join(output, '.release.json');
try {
  const installed = JSON.parse(await readFile(marker, 'utf8'));
  await access(join(output, `CyberChef_v${version}.html`));
  await access(join(output, 'assets/main.js'));
  if (installed.sha256 === digest && installed.pruneBr) { console.log(`CyberChef ${version} already prepared.`); process.exit(0); }
} catch { /* First build or incomplete cache: verify and extract below. */ }
await mkdir(cache, { recursive: true });
const zip = join(cache, `cyberchef-${version}.zip`);
let bytes;
try { bytes = await readFile(zip); } catch {
  console.log(`Downloading CyberChef ${version} (83 MB, once per clean install)…`);
  const response = await fetch(url, { signal: AbortSignal.timeout(180000) });
  if (!response.ok) throw new Error(`CyberChef download failed: HTTP ${response.status}`);
  bytes = Buffer.from(await response.arrayBuffer());
}
if (createHash('sha256').update(bytes).digest('hex') !== digest) throw new Error('CyberChef checksum mismatch; refusing to extract. Remove the cached ZIP and retry.');
await writeFile(zip, bytes);
const names = execFileSync('unzip', ['-Z1', zip], { encoding: 'utf8' }).trim().split('\n');
if (names.some(name => name.startsWith('/') || name.split('/').includes('..') || name.includes('\\'))) throw new Error('Unsafe CyberChef archive path.');
await mkdir(join(root, 'public/pc/vendor'), { recursive: true });
const stage = `${output}.staging-${process.pid}`;
try {
  await mkdir(stage, { recursive: true });
  execFileSync('unzip', ['-q', zip, '-d', stage]);
  const pruned = await pruneBr(stage);
  await writeFile(join(stage, '.release.json'), JSON.stringify({ version, sha256: digest, url, pruneBr: pruned }));
  await rm(output, { recursive: true, force: true });
  await rename(stage, output);
  console.log(`Prepared unmodified CyberChef ${version} minus ${pruned} precompressed .br siblings; licenses retained in bundle.`);
} finally { await rm(stage, { recursive: true, force: true }); }
// GitHub Pages serves the original files and never negotiates precompressed siblings, so the *.br
// copies are dead weight; remove them post-extract and record the cut in the vendor notice.
async function listBr(stage) {
  const found = [];
  await (async function walk(dir) { for (const e of await readdir(dir, { withFileTypes: true })) { const p = join(dir, e.name); if (e.isDirectory()) await walk(p); else if (p.endsWith('.br')) found.push(p); } })(stage);
  return found;
}
async function pruneBr(stage) {
  const br = await listBr(stage);
  if (br.length === 0) throw new Error('CyberChef size cut: no precompressed .br siblings found; the pinned release is expected to ship them.');
  for (const p of br) await rm(p);
  if ((await listBr(stage)).length !== 0) throw new Error('CyberChef size cut: .br files remain after prune.');
  for (const name of [`CyberChef_v${version}.html`, 'assets/main.js', 'assets/main.css']) await access(join(stage, name));
  let text = '';
  try { text = await readFile(join(root, 'public/third-party/cyberchef/NOTICE'), 'utf8'); } catch { }
  text = text.replace('WebPC serves the upstream web release unmodified in /pc/vendor/cyberchef/.', 'WebPC serves the upstream web release in /pc/vendor/cyberchef/, minus the precompressed .br siblings (see below).');
  const note = `WebPC size cut (2026-11-20): the ${br.length} precompressed .br sibling files are removed from the prepared bundle. GitHub Pages serves the original files and does not negotiate precompression, so nothing references them. No other bytes of the upstream release are modified.`;
  if (!text.includes(note)) text = text.trimEnd() + '\n\n' + note + '\n';
  await mkdir(dirname(join(root, 'public/third-party/cyberchef/NOTICE')), { recursive: true });
  await writeFile(join(root, 'public/third-party/cyberchef/NOTICE'), text);
  return br.length;
}
