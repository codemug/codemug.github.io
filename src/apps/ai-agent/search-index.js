// AI-3: pure logic for the Files search index — chunking, cosine top-k and the
// in-memory index bookkeeping. Vectors are Float32Array, already L2-normalized
// (the embedding model runs with normalize: true), so cosine similarity == dot.
// The index is memory only: nothing here is saved to any storage API.
export const CHUNK_SIZE = 800;
export const CHUNK_OVERLAP = 100;
export const MAX_INDEX_CHARS = 5_000_000;
export const SNIPPET_CHARS = 400;
export const DEFAULT_K = 5;
export const MAX_K = 10;

const dot = (a, b) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
};

/**
 * Split text into chunks of at most `size` characters with `overlap` characters
 * shared with the previous chunk. A chunk ends at a paragraph break, else a line
 * break, else hard — the break search only looks in the last third of the window.
 * @returns {Array<{ text: string, offset: number }>}
 */
export function chunkText(text, { size = CHUNK_SIZE, overlap = CHUNK_OVERLAP } = {}) {
  const t = String(text ?? "");
  const chunks = [];
  const ov = Math.max(0, Math.min(overlap, size - 1));
  let start = 0;
  while (start < t.length) {
    let end = Math.min(start + size, t.length);
    if (end < t.length) {
      const from = end - Math.ceil(size / 3);
      let cut = t.lastIndexOf("\n\n", end - 1);
      if (cut <= from) cut = t.lastIndexOf("\n", end - 1);
      if (cut > from) end = cut + 1; // keep the break so the chunk reads cleanly
    }
    chunks.push({ text: t.slice(start, end), offset: start });
    if (end >= t.length) break;
    start = Math.max(end - ov, start + 1); // ov < size, so this always moves forward
  }
  return chunks;
}

/**
 * Indices of the top-k most similar vectors (cosine, == dot for normalized
 * vectors). Ties keep the earlier index; k clamps to 1..n.
 */
export function cosineTopK(vectors, query, k = DEFAULT_K) {
  const n = vectors.length;
  if (!n) return [];
  const kk = Math.min(n, Math.max(1, Math.trunc(Number(k)) || DEFAULT_K));
  return vectors
    .map((v, i) => ({ i, score: dot(v, query) }))
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, kk)
    .map((x) => x.i);
}

/** True when a file's recorded metadata differs from the new one (or it was never indexed). */
export function fileChanged(old, meta) {
  return !old || old.size !== meta.size || old.mtime !== meta.mtime;
}

/** True when adding `chars` more indexed text would pass the cap. */
export function overCharBudget(current, chars, cap = MAX_INDEX_CHARS) {
  return current + chars > cap;
}

/** Top-k results as {path, score (2 decimals), snippet (at most SNIPPET_CHARS)}. */
export function searchResults(entries, queryVector, k = DEFAULT_K) {
  return cosineTopK(entries.map((e) => e.vector), queryVector, k).map((i) => ({
    path: entries[i].path,
    score: Math.round(dot(entries[i].vector, queryVector) * 100) / 100,
    snippet: entries[i].text.slice(0, SNIPPET_CHARS).trim(),
  }));
}

/** The in-memory index: path → { size, mtime, chunks: [{ text, offset, vector }] }. */
export class SearchIndex {
  constructor() {
    this.files = new Map();
  }
  has() {
    for (const f of this.files.values()) if (f.chunks.length) return true;
    return false;
  }
  upsert(path, meta, chunks) {
    this.files.set(path, { size: meta.size, mtime: meta.mtime, chunks });
  }
  /** Drop one grant's chunks: exact path for a file grant, the root and its subtree for a folder. */
  revoke(root, kind) {
    for (const path of [...this.files.keys()]) {
      const hit = kind === "file" ? path === root : root ? path === root || path.startsWith(root + "/") : true;
      if (hit) this.files.delete(path);
    }
  }
  clear() {
    this.files.clear();
  }
  stats() {
    let files = 0, chunks = 0, chars = 0;
    for (const f of this.files.values()) {
      files += 1;
      chunks += f.chunks.length;
      for (const c of f.chunks) chars += c.text.length;
    }
    return { files, chunks, chars };
  }
}
