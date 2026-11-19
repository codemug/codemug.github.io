// A real 32-bit Linux guest. Generated runtime/guest files stay out of git.
import { readFile, writeFile, mkdir, cp, rm, rename, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const root = fileURLToPath(new URL('../../', import.meta.url));
const recipe = join(root, 'scripts/pc/linux');
const output = join(root, 'public/pc/vendor/terminal');
const cache = join(root, 'node_modules/.cache/webpc/linux');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const lockText = await readFile(join(recipe, 'packages.lock.json'), 'utf8');
const lock = JSON.parse(lockText);
const installed = JSON.parse(await readFile(join(root, 'node_modules/v86/package.json'), 'utf8'));
if (installed.version.split('+')[0] !== lock.v86Version) throw new Error(`Expected v86 ${lock.v86Version}; found ${installed.version}. Run npm ci.`);
const runtime = await Promise.all(['v86.wasm', 'libv86.mjs'].map(name => readFile(join(root, 'node_modules/v86/build', name))));
const inputs = await Promise.all(['Dockerfile', 'flatten.py'].map(name => readFile(join(recipe, name))));
const recipeId = sha(Buffer.concat([Buffer.from(lockText), ...inputs, ...runtime, await readFile(fileURLToPath(import.meta.url))]));
try {
  const existing = JSON.parse(await readFile(join(output, 'release.json'), 'utf8'));
  for (const name of ['fs.json', 'v86.wasm', 'libv86.mjs', 'seabios.bin', 'vgabios.bin']) await access(join(output, name));
  if (existing.recipeId === recipeId) { console.log(`Alpine Linux already prepared (${existing.imageId.slice(0, 12)}).`); process.exit(0); }
} catch { /* Missing/incomplete generated output: prepare it. */ }
await mkdir(cache, { recursive: true });
const stage = `${output}.staging-${process.pid}`;
const container = `webpc-linux-export-${process.pid}`;
await mkdir(stage, { recursive: true });
try {
  // Docker is a build-time tool only; the deployed page is completely static.
  execFileSync('docker', ['version', '--format', '{{.Server.Version}}'], { stdio: 'pipe' });
  await cp(join(recipe, 'Dockerfile'), join(cache, 'Dockerfile'));
  await writeFile(join(cache, 'packages.txt'), lock.packages.map(p => `${p.name}=${p.version}`).join('\n'));
  const image = `webpc-linux:${recipeId.slice(0, 16)}`;
  console.log('Preparing pinned Alpine Linux guest (Docker + Python 3 required on a clean build)…');
  execFileSync('docker', ['build', '--platform', 'linux/386', '-t', image, cache], { stdio: 'inherit' });
  execFileSync('docker', ['create', '--name', container, image], { stdio: 'pipe' });
  const tar = join(cache, 'rootfs.tar');
  execFileSync('docker', ['export', container, '-o', tar], { stdio: 'inherit' });
  execFileSync('python3', [join(recipe, 'flatten.py'), tar, stage, String(lock.epoch)], { stdio: 'inherit' });
  for (const name of ['libv86.mjs', 'v86.wasm']) await cp(join(root, 'node_modules/v86/build', name), join(stage, name));
  const bios = {
    'seabios.bin': '73e3f359102e3a9982c35fce98eb7cd08f18303ac7f1ba6ebfbe6cdc1c244d98',
    'vgabios.bin': 'a4bc0d80cc3ca028c73dafa8fee396b8d054ce87ebd8abfbd31b06b437607880',
  };
  for (const [name, digest] of Object.entries(bios)) {
    const url = `https://raw.githubusercontent.com/copy/v86/${lock.v86Commit}/bios/${name}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
    if (!response.ok) throw new Error(`BIOS download failed: HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (sha(bytes) !== digest) throw new Error(`BIOS checksum mismatch: ${name}`);
    await writeFile(join(stage, name), bytes);
  }
  const manifest = await readFile(join(stage, 'fs.json'));
  const imageId = sha(Buffer.concat([manifest, ...runtime, Buffer.from(JSON.stringify(bios)), Buffer.from(JSON.stringify(lock.vm))]));
  await writeFile(join(stage, 'release.json'), JSON.stringify({ version: 1, recipeId, imageId, v86: lock.v86Version, alpine: '3.22', memoryMiB: lock.vm.memoryMiB, vm: lock.vm, guestBytes: JSON.parse(manifest).size }));
  await cp(join(root, 'node_modules/v86/LICENSE'), join(root, 'public/third-party/terminal/v86-LICENSE.txt'));
  await cp(join(recipe, 'packages.lock.json'), join(root, 'public/third-party/terminal/packages.lock.json'));
  await rm(output, { recursive: true, force: true });
  await rename(stage, output);
  console.log(`Prepared Alpine Linux (${imageId.slice(0, 12)}); all guest files served locally.`);
} finally {
  try { execFileSync('docker', ['rm', '-f', container], { stdio: 'pipe' }); } catch { /* May not have reached create. */ }
  await rm(stage, { recursive: true, force: true });
}
