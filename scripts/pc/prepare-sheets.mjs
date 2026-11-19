import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const root = fileURLToPath(new URL('../../', import.meta.url));
const target = join(root, 'public/pc/vendor/sheets');
const sdk = join(root, 'node_modules/@casualoffice/sheets');
const metadata = JSON.parse(await readFile(join(sdk, 'package.json'), 'utf8'));
if (metadata.version !== '0.20.0') throw new Error('Sheets adapter requires exactly @casualoffice/sheets@0.20.0. Review the adapter and browser tests before updating.');
await mkdir(target, { recursive: true });
for (const name of ['embed-runtime.js', 'formula.worker.js', 'parser.worker.js', 'exporter.worker.js']) {
  await copyFile(join(sdk, 'dist/embed', name), join(target, name));
}
await copyFile(join(sdk, 'dist/embed.js'), join(target, 'embed.js'));
await copyFile(join(root, 'scripts/pc/sheets/blank.xlsx'), join(target, 'blank.xlsx'));
const fontFiles = [
  ['inter', 'inter-latin-wght-normal.woff2', 'inter.woff2'],
  ['material-symbols-outlined', 'material-symbols-outlined-latin-wght-normal.woff2', 'material-symbols.woff2'],
];
for (const [pkg, file, output] of fontFiles) {
  await copyFile(join(root, 'node_modules/@fontsource-variable', pkg, 'files', file), join(target, output));
  const license = join(root, 'public/third-party/casual-sheets', `${pkg}-LICENSE`);
  await mkdir(dirname(license), { recursive: true });
  await copyFile(join(root, 'node_modules/@fontsource-variable', pkg, 'LICENSE'), license);
}
await writeFile(join(target, 'fonts.css'), `/* Local fonts: see /third-party/casual-sheets/*-LICENSE. */
@font-face{font-family:Inter;font-style:normal;font-weight:100 900;font-display:swap;src:url('./inter.woff2') format('woff2')}
@font-face{font-family:'Material Symbols Outlined';font-style:normal;font-weight:100 700;font-display:block;src:url('./material-symbols.woff2') format('woff2')}
`);
console.log('Prepared local Casual Sheets 0.20.0 editor, workers and fonts.');
