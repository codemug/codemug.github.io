import { build } from 'esbuild';
import { writeBundleNotices } from './docs/bundle-notices.mjs';
import { cp, mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const root = fileURLToPath(new URL('../../', import.meta.url));
const sdk = join(root, 'node_modules/@casualoffice/docs');
if (JSON.parse(await readFile(join(sdk, 'package.json'))).version !== '1.4.2') throw new Error('Review Docs adapter before updating SDK 1.4.2.');
const out = join(root, 'public/pc/vendor/docs');
await mkdir(out, { recursive: true });
const result = await build({ metafile: true, entryPoints: [join(root, 'scripts/pc/docs/editor.jsx')], outdir: out, entryNames: 'editor', bundle: true, minify: true, splitting: true, format: 'esm', platform: 'browser', target: 'es2022', define: { 'process.env.NODE_ENV': '"production"' }, legalComments: 'eof' });
const css = (await readFile(join(sdk, 'dist/styles.css'), 'utf8')).replace(/@import url\([^)]*\);/g, '');
const localFonts = `@font-face{font-family:Inter;font-style:normal;font-weight:100 900;font-display:swap;src:url('./inter.woff2')}@font-face{font-family:'Material Symbols Outlined';font-style:normal;font-weight:100 700;font-display:block;src:url('./material-symbols.woff2')}`;
await writeFile(join(out, 'styles.css'), localFonts + css + '\n' + await readFile(join(sdk, 'dist/react.css'), 'utf8'));
for (const [pkg, file, target] of [['inter','inter-latin-wght-normal.woff2','inter.woff2'],['material-symbols-outlined','material-symbols-outlined-latin-wght-normal.woff2','material-symbols.woff2']]) {
  await copyFile(join(root, 'node_modules/@fontsource-variable', pkg, 'files', file), join(out, target));
  await copyFile(join(root, 'node_modules/@fontsource-variable', pkg, 'LICENSE'), join(root, 'public/third-party/casual-docs', `${pkg}-LICENSE`));
}
await cp(join(sdk, 'dist/fonts'), join(out, 'fonts'), { recursive: true });
console.log('Prepared local Docs 1.4.2 editor.');

await writeBundleNotices(result.metafile, root, join(root, 'public/third-party/casual-docs/BUNDLED-NOTICES.txt'));
