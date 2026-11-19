// Prepare the self-hosted WebPC "Network and Security Tools" (nettools) vendor bundle:
// esbuild-bundle scripts/pc/nettools/main.mjs (with the pinned @zxcvbn-ts/* and age-encryption
// deps) into public/pc/vendor/nettools/ with code-splitting (heavy tabs load lazily), copy the
// stylesheet, write a CSP-locked index.html, and pin everything with a fingerprint marker.
import { build } from 'esbuild';
import { mkdir, cp, readFile, writeFile, rm, access, rename, readdir, copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rowFingerprint } from './prepare-static-apps.mjs';
import { writeBundleNotices } from './docs/bundle-notices.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const lock = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8'));
const DEPS = [
  { name: '@zxcvbn-ts/core', version: '4.3.0' },
  { name: '@zxcvbn-ts/language-common', version: '4.2.0' },
  { name: '@zxcvbn-ts/language-en', version: '4.1.2' },
  { name: 'age-encryption', version: '0.3.1' },
];
for (const d of DEPS) {
  const entry = lock.packages[`node_modules/${d.name}`];
  if (!entry || entry.version !== d.version) throw new Error(`nettools: expected ${d.name}@${d.version}, found ${entry?.version ?? 'none'}; pin it in package.json and reinstall.`);
}
const versions = Object.fromEntries(DEPS.map(d => [d.name, d.version]));
const srcDir = join(root, 'scripts/pc/nettools');
const srcFiles = (await readdir(srcDir)).filter(f => f.endsWith('.mjs') || f.endsWith('.css')).sort();
const srcTexts = await Promise.all(srcFiles.map(f => readFile(join(srcDir, f), 'utf8')));
const fingerprint = rowFingerprint(await readFile(fileURLToPath(import.meta.url), 'utf8'), [...srcTexts, JSON.stringify(versions)]);

// connect-src is broad ('self' + https:) because RDAP (rdap.org) redirects to many registry
// hosts and the DoH/Globalping services live on separate hosts. That breadth is safe only
// because every such fetch is an explicit user click (never on load or tab switch), each button
// and result names the receiving service, and results render as text only.
const CSP = `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' https:; img-src 'self' data:; object-src 'none'`;
const indexHtml = `<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><meta http-equiv="Content-Security-Policy" content="${CSP}"/><meta name="robots" content="noindex"/><title>Network and Security Tools</title><link rel="stylesheet" href="./nettools.css"/></head><body style="margin:0"><div id="nettools-root"></div><script type="module" src="./nettools.js"></script></body></html>`;

async function prepare() {
  const out = join(root, 'public/pc/vendor/nettools');
  try {
    const installed = JSON.parse(await readFile(join(out, '.release.json'), 'utf8'));
    await access(join(out, 'nettools.js'));
    if (installed.fingerprint === fingerprint) { console.log('nettools already prepared.'); return; }
  } catch { /* First build or source change: rebuild below. */ }
  const stage = `${out}.staging-${process.pid}`;
  await mkdir(stage, { recursive: true });
  try {
    const result = await build({ metafile: true, entryPoints: [join(srcDir, 'main.mjs')], outdir: stage, entryNames: 'nettools', bundle: true, minify: true, splitting: true, format: 'esm', platform: 'browser', target: 'es2022', define: { 'process.env.NODE_ENV': '"production"' }, legalComments: 'eof' });
    await cp(join(srcDir, 'nettools.css'), join(stage, 'nettools.css'));
    await writeFile(join(stage, 'index.html'), indexHtml);
    await writeFile(join(stage, '.release.json'), JSON.stringify({ url: 'WebPC nettools app', fingerprint, versions }));
    await rm(out, { recursive: true, force: true });
    await rename(stage, out);
    const thirdParty = join(root, 'public/third-party/nettools');
    await mkdir(thirdParty, { recursive: true });
    const flatName = d => d.name.replace(/^@/, '').replace('/', '-'); // @zxcvbn-ts/core -> zxcvbn-ts-core
    for (const d of DEPS) {
      const pkgDir = join(root, 'node_modules', d.name);
      let copied = false;
      for (const cand of ['LICENSE', 'LICENSE.md', 'license', 'COPYING', 'NOTICE.md', 'NOTICE']) {
        try { await copyFile(join(pkgDir, cand), join(thirdParty, `${flatName(d)}-${cand}`)); copied = true; break; } catch { /* try next */ }
      }
      if (!copied) {
        // No licence file shipped in the npm package: write the declared licence + repo from
        // the installed package.json so third-party/nettools/ still names the obligation.
        const inst = JSON.parse(await readFile(join(pkgDir, 'package.json'), 'utf8'));
        await writeFile(join(thirdParty, `${flatName(d)}-LICENSE.txt`),
          `${inst.name}@${inst.version} — declared license: ${inst.license}\nNo licence text file is shipped in this npm package; the text is at the project repository (${inst.repository?.url ?? 'n/a'}). See WEBPC.txt.\n`);
      }
    }
    await writeBundleNotices(result.metafile, root, join(thirdParty, 'BUNDLED-NOTICES.txt'));
    await writeFile(join(thirdParty, 'WEBPC.txt'),
      `Network and Security Tools (WebPC app, original code)\nLibraries (devDependencies, exact + lockfile integrity pinned):\n  ${DEPS.map(d => `${d.name}@${d.version}`).join(', ')}\n` +
      `Licenses: @zxcvbn-ts/* (MIT), age-encryption (BSD-3). Full texts in BUNDLED-NOTICES.txt.\n` +
      `WebPC changes: esbuild-bundles scripts/pc/nettools/main.mjs (production, minified, ESM, code-splitting so the heavy tabs load lazily). The Subnet calculator and the password-strength / age file-encryption tools run fully locally (no network). DNS (Cloudflare or Google DoH), domain/IP (RDAP via rdap.org, crt.sh certificate transparency, Shodan InternetDB), global ping/traceroute/mtr (Globalping keyless API) and latency are user-initiated only (explicit click); each button and result names the receiving service; every fetch uses credentials:'omit', referrerPolicy:'no-referrer' and a 15 s timeout; all external results render as text (textContent, never innerHTML). Vendor CSP: ${CSP}. See docs/webpc/nettools.md.\n`);
    console.log('Prepared nettools.');
  } finally { await rm(stage, { recursive: true, force: true }); }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await prepare();
