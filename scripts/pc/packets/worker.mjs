// Packet Viewer engine worker: runs @goodtools/wiregasm (Wireshark 4.6 in WebAssembly)
// off the main thread. The emscripten loader performs no network fetches of its own:
// we inflate the shipped .gz files ourselves and hand the bytes to the loader via
// wasmBinary + getPreloadedPackage. Everything here stays local — no fetch but the
// two same-origin vendor files.
import { Wiregasm, vectorToArray } from '@goodtools/wiregasm';
import loadWiregasm from '@goodtools/wiregasm/dist/wiregasm.js';

const post = (msg) => self.postMessage(msg);
const progress = (stage, detail) => post({ type: 'progress', stage, detail: detail ?? '' });
const fail = (error) => post({ type: 'error', error: String(error) });

let wg = null; // initialized engine
let busy = false;

async function fetchGz(name) {
  const res = await fetch(new URL(name, self.location.href), { credentials: 'omit' });
  if (!res.ok) throw new Error(`could not fetch ${name} (${res.status})`);
  const buf = new Uint8Array(await res.arrayBuffer());
  // Some servers (e.g. the local dev server) answer .gz files with Content-Encoding: gzip,
  // which fetch transparently decodes. Sniff the gzip magic instead of assuming: 0x1f 0x8b
  // means the bytes are still gzip and need DecompressionStream; anything else is already
  // inflated and used as-is.
  const isGz = buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b;
  if (!isGz) return buf.buffer;
  progress('inflate', `inflating ${name} (${(buf.length / 1048576).toFixed(1)} MB)`);
  const ds = new DecompressionStream('gzip');
  const out = await new Response(new Blob([buf]).stream().pipeThrough(ds)).arrayBuffer();
  return out;
}

async function engine() {
  if (wg) return wg;
  progress('fetch', 'fetching the dissection engine (about 21 MB, local files)');
  const [wasmBinary, dataPackage] = await Promise.all([fetchGz('wiregasm.wasm.gz'), fetchGz('wiregasm.data.gz')]);
  progress('init', 'initializing the engine (Wireshark 4.6)');
  wg = new Wiregasm();
  await wg.init(loadWiregasm, {
    wasmBinary,
    getPreloadedPackage: (name, size) => {
      // The loader asks for the "wiregasm.data" package (size matches the inflated bytes).
      if (name !== 'wiregasm.data' || size !== dataPackage.byteLength) {
        throw new Error(`unexpected preloaded package request: ${name} (${size})`);
      }
      return dataPackage;
    },
    handleStatus: (type, message) => {
      if (typeof message === 'string' && message.trim()) progress('init', message.trim().slice(0, 120));
    },
  });
  progress('ready', 'engine ready');
  return wg;
}

// Flatten emscripten vectors into plain cloneable structures (vectorToArray frees handles).
function frameResult(n) {
  const frame = wg.frame(n);
  const dataSources = vectorToArray(frame.data_sources).map(d => ({ name: d.name, data: d.data }));
  const nodes = [];
  const walk = (tree, depth) => {
    for (const t of vectorToArray(tree)) {
      nodes.push({ label: t.label, depth, off: t.length ? `${t.start}+${t.length}` : '' });
      if (depth < 64) walk(t.tree, depth + 1);
    }
  };
  walk(frame.tree, 0);
  const comments = frame.comments ? vectorToArray(frame.comments).filter(Boolean) : [];
  return { number: frame.number, dataSources, nodes, comments };
}

self.addEventListener('message', async event => {
  if (busy) return; // one operation at a time; the UI serializes requests anyway
  busy = true;
  const m = event.data ?? {};
  try {
    if (m.type === 'warm') {
      await engine();
      post({ type: 'warmed' });
    } else if (m.type === 'load-file') {
      const w = await engine();
      progress('load', `loading ${m.name}`);
      const res = w.load(m.name, new Uint8Array(m.bytes));
      if (res.code !== 0) throw new Error(res.error || `wiregasm load failed with code ${res.code}`);
      post({ type: 'loaded', summary: res.summary });
    } else if (m.type === 'frames') {
      if (!wg) throw new Error('engine not loaded');
      const list = wg.frames(m.filter ?? '', 0, m.limit ?? 1000);
      const frames = vectorToArray(list.frames).map(f => [f.number, vectorToArray(f.columns)]);
      post({ type: 'frames', columns: vectorToArray(wg.lib.getColumns()), frames, matched: list.matched });
    } else if (m.type === 'frame') {
      if (!wg) throw new Error('engine not loaded');
      post({ type: 'frame', frame: frameResult(m.number) });
    } else if (m.type === 'test-filter') {
      if (!wg) throw new Error('engine not loaded');
      const t = wg.testFilter(m.filter);
      post({ type: 'test-filter', ok: t.ok, error: t.error });
    } else if (m.type === 'destroy') {
      wg?.destroy();
      wg = null;
      post({ type: 'destroyed' });
    }
  } catch (e) {
    fail(e instanceof Error ? e.message : String(e));
  } finally {
    busy = false;
  }
});
