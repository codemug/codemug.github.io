// Prepare prebuilt static web apps into public/pc/vendor/<id>/; the table below is the extension point.
// Reuse rules from prepare-cyberchef.mjs / prepare-craft.mjs: pin version + SHA-256, verify before
// extraction, reject unsafe archive paths, stage then swap, keep licence files in public/third-party/<id>/.
import { mkdir, readFile, writeFile, rename, rm, readdir, copyFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../../', import.meta.url));
const cache = join(root, 'node_modules/.cache/webpc/static');

// Absolute paths, backslashes and parent-directory traversal are unsafe to extract into vendor output.
export function isUnsafeArchivePath(name) {
  return name.startsWith('/') || name.includes('\\') || name.split('/').includes('..');
}

// Row shape: id, title, version, url, upstream, sha256, notice (WEBPC.txt body), tweak (optional).
// tweak: async (payloadDir) => { … } — in-place bundle fixes (CSP meta, path rewrites), only when needed.
export const staticApps = [
  {
    id: 'sqliteviz',
    title: 'SQLiteViz',
    version: '0.32.1',
    url: 'https://github.com/lana-k/sqliteviz/releases/download/0.32.1/dist.zip',
    upstream: 'https://github.com/lana-k/sqliteviz',
    sha256: '6989a740b598570e684a95d0f561980723be6c4aa7f4e97faf119610866abe46',
    notice: 'Official Vite build, unmodified. All asset URLs are relative, so it serves from the /pc/vendor/sqliteviz/ sub-path. The bundled service worker is scoped to /pc/vendor/sqliteviz/ and only precaches its own assets. Map charts can fetch tiles and fonts from public map tile servers when the user creates a map (user-initiated, like CyberChef URL-fetch operations). See docs/webpc/static-apps.md.',
    tweak: null,
  },
];

async function notices(dir, target, relative = '') {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name), rel = join(relative, entry.name);
    if (entry.isDirectory()) await notices(path, target, rel);
    else if (/^(LICENSE|NOTICE)|\.LICEN[CS]E(?:\.txt)?$/i.test(entry.name)) {
      await mkdir(join(target, relative), { recursive: true });
      await copyFile(path, join(target, rel));
    }
  }
}

async function prepare(app) {
  const output = join(root, 'public/pc/vendor', app.id);
  const marker = join(output, '.release.json');
  try {
    const installed = JSON.parse(await readFile(marker, 'utf8'));
    await access(join(output, 'index.html'));
    if (installed.sha256 === app.sha256) { console.log(`${app.title} ${app.version} already prepared.`); return; }
  } catch { /* First build or incomplete cache: verify and extract below. */ }
  await mkdir(cache, { recursive: true });
  const zip = join(cache, `${app.id}-${app.version}.zip`);
  let bytes;
  try { bytes = await readFile(zip); } catch {
    console.log(`Downloading ${app.title} ${app.version}…`);
    const response = await fetch(app.url, { signal: AbortSignal.timeout(180000) });
    if (!response.ok) throw new Error(`${app.id}: HTTP ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
  }
  if (createHash('sha256').update(bytes).digest('hex') !== app.sha256) throw new Error(`${app.id}: checksum mismatch; no assets replaced.`);
  await writeFile(zip, bytes);
  const names = execFileSync('unzip', ['-Z1', zip], { encoding: 'utf8' }).trim().split('\n');
  if (names.some(isUnsafeArchivePath)) throw new Error(`${app.id}: unsafe archive path`);
  await mkdir(join(root, 'public/pc/vendor'), { recursive: true });
  const stage = `${output}.staging-${process.pid}`;
  await mkdir(stage, { recursive: true });
  try {
    execFileSync('unzip', ['-q', zip, '-d', stage]);
    // Payload is the single top-level directory when the zip wraps one, otherwise the zip root.
    const entries = await readdir(stage, { withFileTypes: true });
    const payload = entries.length === 1 && entries[0].isDirectory() ? join(stage, entries[0].name) : stage;
    try { await access(join(payload, 'index.html')); } catch { throw new Error(`${app.id}: index.html not found in zip payload`); }
    if (app.tweak) await app.tweak(payload);
    const thirdParty = join(root, 'public/third-party', app.id);
    await mkdir(thirdParty, { recursive: true });
    await notices(payload, thirdParty);
    await writeFile(join(thirdParty, 'WEBPC.txt'), `${app.title} ${app.version}\nUpstream: ${app.upstream}\nRelease: ${app.url}\nSHA-256: ${app.sha256}\n${app.notice}\n`);
    await writeFile(join(payload, '.release.json'), JSON.stringify({ version: app.version, sha256: app.sha256, url: app.url }));
    await rm(output, { recursive: true, force: true });
    await rename(payload, output);
  } finally { await rm(stage, { recursive: true, force: true }); }
  console.log(`Prepared ${app.title} ${app.version}.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) for (const app of staticApps) await prepare(app);
