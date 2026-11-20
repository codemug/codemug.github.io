// AI-3 browser glue for the Files search index: walks the granted folders in OPFS
// (shared Files store, webpc-files/ only), chunks text files with the same text and
// size rules as read_file, embeds them with the injected `embed` (the local MiniLM
// worker) and keeps the index in memory only. A Files 'changed' broadcast re-indexes
// only the files whose size or mtime moved; everything else is skipped.
import * as fileStore from "./store.mjs";
import { readText } from "./file-tools.js";
import { chunkText, fileChanged, overCharBudget, searchResults, SearchIndex, DEFAULT_K } from "./search-index.js";

/**
 * @param {{
 *   grants: Array<{root: string, kind: 'folder'|'file'}>,
 *   embed: (texts: string[]) => Promise<Float32Array[]>,
 *   note?: (text: string) => void,
 *   onState?: () => void,
 * }} host
 */
export function createSearchHost({ grants, embed, note = () => {}, onState = () => {} }) {
  const index = new SearchIndex();
  let busy = false;
  // The Files refresh channel is (re)created lazily: dispose() closes it (New chat), and the next
  // index build recreates it, so the auto-refresh is not dead for the rest of the session.
  let channel = null;
  const ensureChannel = () => {
    if (channel) return;
    channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("webpc-files") : null;
    channel?.addEventListener("message", (event) => {
      if (event.data?.type === "changed") refresh().catch(() => {});
    });
  };
  ensureChannel();

  // Files app layout: folders first, then files; recursion gives every granted file's full path.
  async function walk(dir, out) {
    for (const item of await fileStore.list(dir)) {
      const path = dir ? `${dir}/${item.name}` : item.name;
      if (item.kind === "folder") await walk(path, out);
      else out.push({ path, name: item.name });
    }
  }

  async function targets() {
    const all = [];
    for (const grant of grants) {
      if (grant.kind === "file") all.push({ path: grant.root, name: grant.root.split("/").at(-1) });
      else await walk(grant.root, all);
    }
    return all;
  }

  /** Index (or re-index) every granted text file. Skips unchanged files; AbortError cancels. */
  async function indexFiles({ signal } = {}) {
    if (busy) return { error: "An index build is already running." };
    if (!grants.length) return { error: "Grant a folder or file first." };
    busy = true;
    ensureChannel(); // dispose() (New chat) may have closed it; recreate before the walk
    try {
      const found = await targets();
      const queue = []; // { path, meta, chunks }
      let skipped = 0, unchanged = 0, rejected = 0, capped = 0;
      let chars = 0;
      for (const f of index.files.values()) for (const c of f.chunks) chars += c.text.length;
      for (const t of found) {
        if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
        const parent = t.path.split("/").slice(0, -1).join("/");
        let read;
        try { read = await fileStore.read(parent, t.name); } catch { skipped += 1; continue; }
        const meta = { size: read.data.size, mtime: read.modified };
        const existing = index.files.get(t.path);
        if (!fileChanged(existing, meta)) { unchanged += 1; continue; }
        const text = readText(new Uint8Array(await read.data.arrayBuffer()), t.name);
        if (text.error) {
          if (existing) { index.files.delete(t.path); for (const c of existing.chunks) chars -= c.text.length; }
          rejected += 1;
          continue; // binary / PDF / too large / non-UTF-8: the same rules as read_file
        }
        if (existing) { index.files.delete(t.path); for (const c of existing.chunks) chars -= c.text.length; }
        if (overCharBudget(chars, text.text.length)) { capped += 1; continue; }
        chars += text.text.length;
        queue.push({ path: t.path, meta, chunks: chunkText(text.text) });
      }
      let embedded = 0;
      for (const job of queue) {
        if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
        note(`Embedding ${job.path} (${embedded + 1}/${queue.length})…`);
        const vectors = await embed(job.chunks.map((c) => c.text));
        if (vectors.length !== job.chunks.length) throw new Error("The embedding model returned too few vectors.");
        job.chunks.forEach((c, i) => { c.vector = vectors[i]; });
        index.upsert(job.path, job.meta, job.chunks);
        embedded += 1;
        onState(); // the search tool appears as soon as the first file lands
      }
      const s = index.stats();
      note(`Index ready: ${s.files} files, ${s.chunks} chunks${unchanged ? `, ${unchanged} unchanged` : ""}${rejected ? `, ${rejected} not text` : ""}${capped ? `, ${capped} over the 5 MB cap` : ""}${skipped ? `, ${skipped} missing` : ""}.`);
      return { ...s, embedded, unchanged, rejected, capped, skipped };
    } finally {
      busy = false;
    }
  }

  async function refresh() {
    if (busy || !grants.length || !index.has()) return;
    const result = await indexFiles({});
    note(`Index refreshed: ${result.embedded} changed, ${result.unchanged} unchanged.`);
  }

  async function search(query, k = DEFAULT_K) {
    const entries = [];
    for (const [path, f] of index.files) for (const c of f.chunks) entries.push({ path, text: c.text, vector: c.vector });
    if (!entries.length) return { error: "The search index is empty. Build it in Settings first." };
    const vectors = await embed([query]);
    if (!vectors?.length) return { error: "The embedding model returned no vector." };
    return searchResults(entries, vectors[0], k);
  }

  const revokeGrant = (grant) => {
    if (!grant) return;
    index.revoke(grant.root, grant.kind);
    onState();
  };
  const dispose = () => {
    channel?.close();
    channel = null; // the next indexFiles recreates it — New chat must not kill auto-refresh for good
    index.clear();
    onState();
  };
  return { indexFiles, search, revokeGrant, has: () => index.has(), stats: () => index.stats(), dispose };
}
