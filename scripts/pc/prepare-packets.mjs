// Prepare the self-hosted WebPC "Packet Viewer" (packets) vendor bundle:
// download @goodtools/wiregasm 2.0.0 from the npm registry (pinned sha512 integrity), verify,
// reject unsafe archive paths, extract with the system tar into staging, ship only the two
// .gz engine assets to public/pc/vendor/packets/, esbuild-bundle scripts/pc/packets/ (app
// entry + engine worker, with the wiregasm package aliased into the staged tarball), write a
// CSP-locked index.html, and pin everything with a fingerprint marker.
import { build } from 'esbuild';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile, rm, access, rename, readdir, copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { rowFingerprint } from './prepare-static-apps.mjs';

const exec = promisify(execFile);
const VERSION = '2.0.0';
const TARBALL = `https://registry.npmjs.org/@goodtools/wiregasm/-/wiregasm-${VERSION}.tgz`;
// npm dist.integrity, read once via `npm view @goodtools/wiregasm@2.0.0 dist.integrity`.
const INTEGRITY = 'sha512-pAt6nckRGu8A1EDO0c0n6sXDtIZGLAWDdeeKiQDwtFxOP1RvKmyNE3okFKJkC9ex0/x2afuvYYMGWJCxepku/w==';
const REPO = 'https://github.com/good-tools/wiregasm';
const LICENSE_ID = 'GPL-2.0-or-later';

const root = fileURLToPath(new URL('../../', import.meta.url));
const out = join(root, 'public/pc/vendor/packets');
const srcDir = join(root, 'scripts/pc/packets');
const srcFiles = (await readdir(srcDir)).filter(f => f.endsWith('.mjs') || f.endsWith('.css')).sort();
const srcTexts = await Promise.all(srcFiles.map(f => readFile(join(srcDir, f), 'utf8')));
const fingerprint = rowFingerprint(await readFile(fileURLToPath(import.meta.url), 'utf8'), [...srcTexts, JSON.stringify({ '@goodtools/wiregasm': VERSION, integrity: INTEGRITY })]);

// No inline styles/scripts in the index.html, no worker created from a blob or data URL,
// and no cross-origin fetch anywhere: the worker and both engine files are same-origin.
const CSP = `default-src 'self'; worker-src 'self' blob:; connect-src 'self'`;
const indexHtml = `<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><meta http-equiv="Content-Security-Policy" content="${CSP}"/><meta name="robots" content="noindex"/><title>Packet Viewer</title><link rel="stylesheet" href="./packets.css"/></head><body><div id="packets-root"><div class="pk-card"><div class="pk-rowline"><button class="pk-btn" id="pk-browse">Choose capture…</button><input class="pk-fileinput" id="pk-file" type="file" accept=".pcap,.pcapng,application/vnd.tcpdump.pcap"/><button class="pk-btn" id="pk-load-engine">Load engine</button><span class="pk-hint">or drag &amp; drop a .pcap / .pcapng file anywhere</span></div><p class="pk-progress" id="pk-progress">Engine not loaded yet. Choose a capture or click "Load engine".</p><p class="pk-err" id="pk-err"></p></div><div class="pk-card"><div class="pk-rowline"><input class="pk-input pk-filter" id="pk-filter" type="text" placeholder="Display filter, e.g. udp or tcp.port == 53 (Enter to apply)"/><button class="pk-btn" id="pk-filter-apply">Apply filter</button><span class="pk-err" id="pk-filter-err"></span></div><p class="pk-summary" id="pk-summary"></p></div><div class="pk-panes"><div class="pk-pane"><h3>Packets</h3><div class="pk-scroll"><table class="pk-table" id="pk-table"><thead></thead><tbody></tbody></table></div></div><div class="pk-pane pk-detail"><h4>Protocol tree</h4><div class="pk-pre-wrap"><pre class="pk-pre" id="pk-tree">No packet selected.</pre></div><h4>Hex dump</h4><div class="pk-hexbox"><pre class="pk-pre" id="pk-hex"></pre></div></div></div></div><script type="module" src="./app.js"></script></body></html>`;

// Files the browser must fetch at runtime; everything else (loader JS, wrapper) is
// esbuild-bundled into app.js/worker.js from the staged tarball.
const RUNTIME_ASSETS = ['wiregasm.wasm.gz', 'wiregasm.data.gz'];

async function sha512(file) {
  return 'sha512-' + createHash('sha512').update(await readFile(file)).digest('base64');
}

async function prepare() {
  const versions = { '@goodtools/wiregasm': VERSION };
  try {
    const installed = JSON.parse(await readFile(join(out, '.release.json'), 'utf8'));
    await access(join(out, 'app.js'));
    for (const a of RUNTIME_ASSETS) await access(join(out, a));
    if (installed.fingerprint === fingerprint) { console.log('packets already prepared.'); return; }
  } catch { /* First build or source change: rebuild below. */ }
  const stage = `${out}.staging-${process.pid}`;
  const extract = `${out}.extract-${process.pid}`;
  const tgz = `${out}.tgz-${process.pid}`;
  try {
    await mkdir(stage, { recursive: true });
    // 1. Download + verify the pinned tarball (kept outside the staged layout that becomes
    //    out/, so neither the tarball nor the extracted package ever ship).
    const res = await fetch(TARBALL, { signal: AbortSignal.timeout(300000) });
    if (!res.ok) throw new Error(`download failed: ${res.status} ${res.statusText}`);
    await writeFile(tgz, Buffer.from(await res.arrayBuffer()));
    const actual = await sha512(tgz);
    if (actual !== INTEGRITY) throw new Error(`wiregasm ${VERSION} tarball sha512 mismatch: got ${actual}, expected ${INTEGRITY}`);

    // 2. Reject unsafe archive paths, then extract with the system tar (outside the layout
    //    that becomes out/, so the 73 MB raw wasm never ships).
    const { stdout } = await exec('tar', ['-tzf', tgz]);
    for (const line of stdout.split('\n')) {
      const name = line.split(' -> ')[0]; // npm tarballs store plain paths
      if (!name) continue; // trailing newline
      if (name.startsWith('/') || name.split('/').includes('..')) throw new Error(`unsafe archive path in wiregasm tarball: ${name}`);
    }
    await mkdir(extract, { recursive: true });
    await exec('tar', ['-xzf', tgz, '-C', extract]);
    const dist = join(extract, 'package', 'dist');

    // 3. Fail loudly if the loader's runtime asset names are not covered by what we ship.
    // The emscripten loader fetches nothing at runtime because we hand it wasmBinary +
    // getPreloadedPackage; this check pins that contract to the shipped files.
    const loaderSrc = await readFile(join(dist, 'wiregasm.js'), 'utf8');
    const loaderAssets = [...new Set([...loaderSrc.matchAll(/locateFile\('([^']+)'\)/g), ...loaderSrc.matchAll(/REMOTE_PACKAGE_BASE = '([^']+)'/g)].map(m => m[1]))];
    for (const asset of loaderAssets) {
      if (!RUNTIME_ASSETS.includes(`${asset}.gz`) && !RUNTIME_ASSETS.includes(asset)) {
        throw new Error(`wiregasm loader references asset "${asset}" but it is not in the shipped set ${JSON.stringify(RUNTIME_ASSETS)}`);
      }
    }
    if (/from\s+['"]\.\.?\//.test(await readFile(join(dist, 'module.js'), 'utf8'))) {
      throw new Error('wiregasm module.js gained relative imports; re-verify what the bundle needs (PhotoCraft lesson)');
    }

    // 4. Ship only the runtime assets; bundle the app and the engine worker.
    for (const a of RUNTIME_ASSETS) await copyFile(join(dist, a), join(stage, a));
    const alias = { '@goodtools/wiregasm': join(dist, 'module.js'), '@goodtools/wiregasm/dist/wiregasm.js': join(dist, 'wiregasm.js') };
    await build({ entryPoints: [join(srcDir, 'main.mjs')], outdir: stage, entryNames: 'app', bundle: true, minify: true, splitting: false, format: 'esm', platform: 'browser', target: 'es2022', define: { 'process.env.NODE_ENV': '"production"' }, legalComments: 'eof', alias });
    // Node-only require() calls inside the emscripten loader (guarded by ENVIRONMENT_IS_NODE
    // at runtime, never hit in a browser worker) must be left external for esbuild.
    await build({ entryPoints: [join(srcDir, 'worker.mjs')], outdir: stage, entryNames: 'worker', bundle: true, minify: true, splitting: false, format: 'iife', platform: 'browser', target: 'es2022', define: { 'process.env.NODE_ENV': '"production"' }, legalComments: 'eof', alias, external: ['fs', 'node:fs', 'ws', 'node:child_process'] });
    await copyFile(join(srcDir, 'packets.css'), join(stage, 'packets.css'));
    await writeFile(join(stage, 'index.html'), indexHtml);
    await writeFile(join(stage, '.release.json'), JSON.stringify({ url: 'WebPC packets app', fingerprint, versions }));

    // 5. GPL notice: the package's licence text plus a WEBPC.txt with the source location.
    const thirdParty = join(root, 'public/third-party/packets');
    await mkdir(thirdParty, { recursive: true });
    await copyFile(join(extract, 'package', 'LICENSE'), join(thirdParty, 'LICENSE'));
    await writeFile(join(thirdParty, 'WEBPC.txt'),
      `Packet Viewer (WebPC app)\n  App UI (original WebPC code): scripts/pc/packets/*.mjs, esbuild-bundled into app.js + worker.js (production, minified).\n  Dissection engine: @goodtools/wiregasm@${VERSION} (license: ${LICENSE_ID})\n    Tarball: ${TARBALL}\n    Integrity (npm dist.integrity): ${INTEGRITY}\n    Upstream repo: ${REPO} (Wireshark 4.6 compiled to WebAssembly; source at the matching v${VERSION} tag / npm published tarball)\n    Shipped here: wiregasm.wasm.gz + wiregasm.data.gz (raw 73 MB wasm and 2.6 MB data are NOT shipped;\n    the page inflates the .gz files in the browser with DecompressionStream('gzip') and hands the bytes\n    to the emscripten loader via wasmBinary + getPreloadedPackage, so the loader never fetches).\n    Full licence text: LICENSE (this directory).\n  Tweak: the worker sniffs the gzip magic (0x1f 0x8b) before inflating, because the local dev\n    server answers .gz files with Content-Encoding: gzip and fetch then hands the worker already-\n    inflated bytes; static hosts that serve the raw .gz are handled by the normal inflate path.\n    No other tweaks — every loader-referenced asset (wiregasm.wasm, wiregasm.data) is covered by a\n    shipped .gz file, and the loader makes zero runtime fetches. See docs/webpc/packets.md.\n`);
    // 6. Swap the staged layout into place.
    await rm(out, { recursive: true, force: true });
    await rename(stage, out);
    console.log(`Prepared packets (wiregasm ${VERSION}, ${loaderAssets.length} loader assets verified).`);
  } finally { await Promise.allSettled([rm(stage, { recursive: true, force: true }), rm(extract, { recursive: true, force: true }), rm(tgz, { force: true })]); }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await prepare();
