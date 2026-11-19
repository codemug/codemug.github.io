// Prepare the self-hosted Excalidraw vendor bundle: esbuild-bundle scripts/pc/excalidraw/main.jsx
// (with the installed @excalidraw/excalidraw and react/react-dom) into public/pc/vendor/excalidraw/,
// copy the package's font files (fonts load lazily from EXCALIDRAW_ASSET_PATH), write a CSP-locked
// index.html, and pin everything with a fingerprint marker (same scheme as prepare-static-apps.mjs).
import { build } from 'esbuild';
import { mkdir, cp, readFile, writeFile, rm, access, rename, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rowFingerprint } from './prepare-static-apps.mjs';
import { writeBundleNotices } from './docs/bundle-notices.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const pkg = join(root, 'node_modules/@excalidraw/excalidraw');
const pkgJson = JSON.parse(await readFile(join(pkg, 'package.json'), 'utf8'));
if (pkgJson.version !== '0.18.1') throw new Error(`Excalidraw is pinned to 0.18.1; found ${pkgJson.version}. Review before updating.`);
const lock = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8'));
const integrity = lock.packages?.['node_modules/@excalidraw/excalidraw']?.integrity;
if (!integrity) throw new Error('Excalidraw integrity missing from package-lock.json; refusing to prepare.');
const versions = { excalidraw: pkgJson.version, react: lock.packages['node_modules/react'].version, reactDom: lock.packages['node_modules/react-dom'].version };
// Belt-and-braces CDN removal (applied to the built output after esbuild). The upstream bundle's
// createUrls() ALWAYS appends an esm.sh CDN fallback URL after the EXCALIDRAW_ASSET_PATH local URL,
// so a FontFace src list carries [local, CDN]; the browser then fetches the CDN source, which our
// CSP blocks -> system-font fallback. Patch 1 removes that CDN push so createUrls returns local-only
// URLs; patch 2 drops the now-dead esm.sh literal from the ASSETS_FALLBACK_URL constant so no CDN
// domain string survives in the vendored output. Both fail loudly unless found exactly once.
const CDN_STRIP = {
  version: 1,
  // `return n.push(new URL(a,Zr.ASSETS_FALLBACK_URL)),n}` -> `return n}` (local URLs only)
  createUrls: /return\s*(\w+)\.push\(\s*new URL\(\s*\w+\s*,\s*\w+\.ASSETS_FALLBACK_URL\s*\)\s*\)\s*,\s*\1\s*\}/g,
  // `...,"ASSETS_FALLBACK_URL",`https://esm.sh/${...}`` -> drop the https://esm.sh/ base literal
  esmShLiteral: /https:\/\/esm\.sh\//g,
};
const fingerprint = rowFingerprint(await readFile(fileURLToPath(import.meta.url), 'utf8'), [
  await readFile(join(root, 'scripts/pc/excalidraw/main.jsx'), 'utf8'),
  await readFile(join(root, 'scripts/pc/excalidraw/storage.mjs'), 'utf8'),
  JSON.stringify(versions),
  `cdn-strip-v${CDN_STRIP.version}`,
]);
const license = { url: 'https://raw.githubusercontent.com/excalidraw/excalidraw/v0.18.1/LICENSE', sha256: '1352d204fdb90d5e482c13139d848bc2c9300a9a7de358a0a558a23e72d0d8be', name: 'LICENSE' };

// Apply the CDN-removal patches to every built .js file; each must match exactly once across the
// whole output or the upstream minified form changed and the prep must stop.
async function stripCdnFallback(dir) {
  let createUrlsHits = 0;
  let esmHits = 0;
  for (const name of (await readdir(dir)).filter(n => n.endsWith('.js'))) {
    const path = join(dir, name);
    let code = await readFile(path, 'utf8');
    CDN_STRIP.createUrls.lastIndex = 0;
    createUrlsHits += code.match(CDN_STRIP.createUrls)?.length ?? 0;
    CDN_STRIP.esmShLiteral.lastIndex = 0;
    esmHits += code.match(CDN_STRIP.esmShLiteral)?.length ?? 0;
    if (createUrlsHits || esmHits) {
      CDN_STRIP.createUrls.lastIndex = 0;
      code = code.replace(CDN_STRIP.createUrls, 'return $1}');
      CDN_STRIP.esmShLiteral.lastIndex = 0;
      code = code.replace(CDN_STRIP.esmShLiteral, '');
      await writeFile(path, code);
    }
  }
  if (createUrlsHits !== 1) throw new Error(`Expected exactly 1 esm.sh CDN-fallback push in createUrls(), found ${createUrlsHits}; the upstream minified form changed — review before updating.`);
  if (esmHits !== 1) throw new Error(`Expected exactly 1 https://esm.sh/ literal in the bundle, found ${esmHits}; the upstream form changed — review before updating.`);
}

async function prepare() {
  const out = join(root, 'public/pc/vendor/excalidraw');
  try {
    const installed = JSON.parse(await readFile(join(out, '.release.json'), 'utf8'));
    await access(join(out, 'excalidraw.js'));
    if (installed.version === versions.excalidraw && installed.integrity === integrity && installed.fingerprint === fingerprint) { console.log(`Excalidraw ${versions.excalidraw} already prepared.`); return; }
  } catch { /* First build or incomplete output: rebuild below. */ }
  const stage = `${out}.staging-${process.pid}`;
  await mkdir(stage, { recursive: true });
  try {
    const result = await build({ metafile: true, entryPoints: [join(root, 'scripts/pc/excalidraw/main.jsx')], outdir: stage, entryNames: 'excalidraw', bundle: true, minify: true, splitting: true, format: 'esm', platform: 'browser', target: 'es2022', conditions: ['production'], define: { 'process.env.NODE_ENV': '"production"' }, legalComments: 'eof' });
    // Copy the package's prebuilt CSS verbatim (the Docs pattern): its url("./fonts/...") refs then
    // resolve against the copied fonts/ directory instead of being rewritten into the bundle.
    await cp(join(pkg, 'dist/prod/index.css'), join(stage, 'excalidraw.css'));
    await cp(join(pkg, 'dist/prod/fonts'), join(stage, 'fonts'), { recursive: true });
    await stripCdnFallback(stage);
    await writeFile(join(stage, 'webpc-config.js'), '// Set before the bundle loads so every font resolves to the local copy under this path (never a CDN).\nwindow.EXCALIDRAW_ASSET_PATH = "/pc/vendor/excalidraw/";\n');
    await writeFile(join(stage, 'index.html'), '<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\'; style-src \'self\' \'unsafe-inline\'; font-src \'self\' data: blob:; img-src \'self\' data: blob:; connect-src \'self\' blob: data:; worker-src \'self\' blob:; frame-src \'self\'; object-src \'none\'"/><meta name="robots" content="noindex"/><title>Excalidraw</title><link rel="stylesheet" href="./excalidraw.css"/><script src="./webpc-config.js"></script></head><body style="margin:0;overflow:hidden"><div id="excalidraw-root" style="height:100vh"></div><script type="module" src="./excalidraw.js"></script></body></html>');
    await writeFile(join(stage, '.release.json'), JSON.stringify({ version: versions.excalidraw, integrity, url: 'npm @excalidraw/excalidraw@0.18.1', fingerprint }));
    await rm(out, { recursive: true, force: true });
    await rename(stage, out);
    const thirdParty = join(root, 'public/third-party/excalidraw');
    await mkdir(thirdParty, { recursive: true });
    const response = await fetch(license.url, { signal: AbortSignal.timeout(60000) });
    const text = Buffer.from(await response.arrayBuffer());
    if (createHash('sha256').update(text).digest('hex') !== license.sha256) throw new Error('Excalidraw licence checksum mismatch; not copied.');
    await writeFile(join(thirdParty, license.name), text);
    await writeBundleNotices(result.metafile, root, join(thirdParty, 'BUNDLED-NOTICES.txt'));
    await writeFile(join(thirdParty, 'WEBPC.txt'), `Excalidraw ${versions.excalidraw} (MIT)\nUpstream: https://github.com/excalidraw/excalidraw\nRelease: npm @excalidraw/excalidraw@0.18.1 (lockfile integrity ${integrity}; the package ships no licence file, so the repo LICENSE at tag v0.18.1 is pinned by SHA-256)\nWebPC changes: bundles the npm package with the installed react/react-dom ${versions.react}; self-hosts all fonts (webpc-config.js sets EXCALIDRAW_ASSET_PATH to /pc/vendor/excalidraw/ before the bundle loads, and the prep step strips the upstream esm.sh CDN fallback from the bundle's createUrls() so every font src is local-only — no CDN font requests are possible); adds a CSP meta (script-src 'self', worker-src 'self' blob: — the bundled image-blob-reduce helper's data:-URL worker is blocked but has a built-in fallback, third-party connect/frame sources blocked — in-page third-party embeds cannot load); the scene autosaves to the WebPC-namespaced localStorage key pc:excalidraw:scene:v1 and is restored on open. No collaboration props are passed, so the bundled room/collab client (firebase/cloudfunctions URLs in the bundle) is inactive. Excalidraw+ / library / share links are user-click new-tab links only. See docs/webpc/excalidraw.md.\n`);
    console.log(`Prepared Excalidraw ${versions.excalidraw}.`);
  } finally { await rm(stage, { recursive: true, force: true }); }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await prepare();
