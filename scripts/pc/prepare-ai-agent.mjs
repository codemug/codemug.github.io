// Rebuild an explicit public allowlist; no home-directory source, private configs, or databases.
import { mkdir, readFile, writeFile, copyFile, cp, rename, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const root = fileURLToPath(new URL('../../', import.meta.url));
const source = join(root, 'src/apps/ai-agent');
const output = join(root, 'public/pc/vendor/ai-agent');
const cache = join(root, 'node_modules/.cache/webpc/ai-agent');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const artifacts = [
  ['transformers.min.js', '@huggingface/transformers@4.3.2/dist/transformers.min.js', '8b5a3171f8876bab2b1820a7d65eb87628e3d30bb5ea85b9dd398e76eb34decb'],
  ['ort-wasm-simd-threaded.asyncify.mjs', 'onnxruntime-web@1.31.0-dev.20260914-8d85527a0/dist/ort-wasm-simd-threaded.asyncify.mjs', '0966b6105cd936744498aa60df7a22cbd47af3374dbc64a9ab561c08a71e3611'],
  ['ort-wasm-simd-threaded.asyncify.wasm', 'onnxruntime-web@1.31.0-dev.20260914-8d85527a0/dist/ort-wasm-simd-threaded.asyncify.wasm', '49871f5a4409519797e127440868a6d1923339d9185907f301a5b2a1d90af082'],
  ['Readability.js', '@mozilla/readability@0.6.0/Readability.js', '34dcab3d0832d0019f02990eed6b6124e029e8c32b9f0c6f2550544ff8dff174'],
  ['idb-keyval.js', 'idb-keyval@6.2.1/dist/index.js', '541fcbcdaeb77fa87250844fd40e1ed0faf79be2e7f29be1aefb8b9ca19f7ce5'],
];
await mkdir(cache, { recursive: true });
const stage = `${output}.staging-${process.pid}`;
try {
  await mkdir(join(stage, 'vendor'), { recursive: true });
  for (const [name, path, digest] of artifacts) {
    let bytes; try { bytes = await readFile(join(cache, name)); } catch {}
    if (!bytes || hash(bytes) !== digest) {
      console.log(`Downloading pinned AI Agent dependency: ${name}`);
      const response = await fetch(`https://cdn.jsdelivr.net/npm/${path}`, { signal: AbortSignal.timeout(180000) });
      if (!response.ok) throw new Error(`AI Agent dependency ${name}: HTTP ${response.status}`);
      bytes = Buffer.from(await response.arrayBuffer());
    }
    if (hash(bytes) !== digest) throw new Error(`AI Agent dependency checksum mismatch: ${name}`);
    await writeFile(join(cache, name), bytes);
    if (name.endsWith('.wasm')) {
      await writeFile(join(stage, 'vendor', `${name}.parta`), bytes.subarray(0, 14000000));
      await writeFile(join(stage, 'vendor', `${name}.partb`), bytes.subarray(14000000));
    } else if (name === 'Readability.js') {
      const footer = 'if (typeof module === "object") {\n  /* eslint-disable-next-line no-redeclare */\n  /* global module */\n  module.exports = Readability;\n}';
      const text = bytes.toString(); if (!text.includes(footer)) throw new Error('Unexpected Readability export format');
      await writeFile(join(stage, 'vendor/readability.mjs'), '// @mozilla/readability 0.6.0 (Apache-2.0), CommonJS footer replaced with an ESM export.\n' + text.replace(footer, 'export { Readability };'));
    } else await writeFile(join(stage, 'vendor', name), name === 'idb-keyval.js' ? Buffer.concat([Buffer.from('// idb-keyval 6.2.1 (Apache-2.0) dist/index.js\n'), bytes]) : bytes);
  }
  for (const name of ['app.js','agent.js','models.js','model-client.js','storage.js','session.js','web.js','worker.js','sandbox.js','styles.css']) await copyFile(join(source, name), join(stage, name));
  await copyFile(join(root, 'public/third-party/ai-agent/NOTICE.txt'), join(stage, 'NOTICE.txt'));
  await cp(join(root, 'public/third-party/ai-agent/licenses'), join(stage, 'licenses'), { recursive: true });
  await writeFile(join(stage, 'release.json'), JSON.stringify({ artifacts: artifacts.map(([file,path,sha256])=>({file,url:`https://cdn.jsdelivr.net/npm/${path}`,sha256})) }, null, 2));
  await rm(output, { recursive: true, force: true }); await rename(stage, output);
} finally { await rm(stage, { recursive: true, force: true }); }
console.log('Prepared AI Agent static sources and verified local runtime (no model weights).');
