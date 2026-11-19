import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

// Preserve the installed packages' full license texts alongside esbuild's
// retained legal comments. Only packages that contributed to this bundle count.
export async function writeBundleNotices(meta, root, output) {
  const packages = new Set();
  for (const input of Object.keys(meta.inputs)) {
    const parts = input.split('node_modules/');
    if (parts.length < 2) continue;
    const tail = parts.at(-1).split('/');
    const name = tail[0].startsWith('@') ? tail.slice(0, 2).join('/') : tail[0];
    const prefix = input.slice(0, input.lastIndexOf('node_modules/') + 'node_modules/'.length);
    packages.add(resolve(root, prefix, name));
  }
  const blocks = [];
  for (const path of [...packages].sort()) {
    const pkg = JSON.parse(await readFile(join(path, 'package.json'), 'utf8'));
    const files = (await readdir(path)).filter(name => /^(licen[sc]e|copying|notice)(\.|$|-)/i.test(name));
    blocks.push(`\n===== ${pkg.name} ${pkg.version} (${pkg.license || 'see upstream license'}) =====\n`);
    for (const file of files) { try { blocks.push(`\n--- ${file} ---\n${await readFile(join(path, file), 'utf8')}`); } catch {} }
    if (!files.length) blocks.push(`Upstream package: https://www.npmjs.com/package/${pkg.name}\n`);
  }
  await writeFile(output, blocks.join('\n'));
}
