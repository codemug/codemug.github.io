// AI-2: pure logic for the Files tools (unit-tested in Node, no DOM/OPFS).
// Grants are per-session state owned by the app (never persisted); a grant is
// { root: 'notes' | 'notes/a.txt', kind: 'folder' | 'file' } relative to the
// Files app's webpc-files/ root. Tool paths are ALSO relative to that root (not to a
// grant): the resolver admits a path only under a folder grant's root (segment prefix;
// a "" folder grant covers everything) or exactly at a file grant's root.
export const MAX_READ_BYTES = 200_000;
export const MAX_WRITE_CHARS = 200_000;
export const MAX_LIST_ENTRIES = 500;
const MAX_PATH_CHARS = 200;
// Control characters, plus bidi controls and zero-width/variation characters: they let a written
// path or file name visually spoof the confirm dialog (a direction override or an invisible tag).
const CONTROL = /[\u0000-\u001f\u007f]|[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]|[\u{E0000}-\u{E007F}]/u;
// read_file is text-only; PDFs get their own pointer to PDFCraft.
export const TEXT_EXTS = new Set([
  "txt", "md", "markdown", "csv", "tsv", "json", "jsonl", "ndjson", "html", "htm", "xml",
  "js", "mjs", "cjs", "jsx", "ts", "tsx", "py", "css", "scss", "yml", "yaml", "toml",
  "ini", "cfg", "conf", "env", "log", "sh", "bash", "sql", "h", "hpp", "c", "cc", "cpp",
  "cs", "go", "rs", "rb", "php", "svg", "tex", "gitignore", "dockerfile",
]);

/** Lowercase extension of a file name ("" for none or a leading dot only). */
export function extension(name) {
  const dot = String(name).lastIndexOf(".");
  return dot > 0 ? String(name).slice(dot + 1).toLowerCase() : "";
}

/**
 * Resolve a model-supplied path against the current grants.
 * @param {Array<{root: string, kind: 'folder'|'file'}>} grants
 * @param {string} raw path relative to the Files app root (webpc-files/), e.g. "notes/a.txt".
 * @param {{ forWrite?: boolean }} opts forWrite: true counts only FOLDER grants.
 * @returns {{ path: string } | { error: string }} the admitted path, or the grant list error.
 */
export function resolveInGrants(grants, raw, { forWrite = false } = {}) {
  if (typeof raw !== "string" || raw.length > MAX_PATH_CHARS) return { error: `path must be a string of at most ${MAX_PATH_CHARS} characters` };
  if (raw.startsWith("/") || raw.startsWith("\\")) return { error: "Absolute paths are not allowed; paths are relative to the Files app root." };
  if (raw.includes("\\")) return { error: "Backslashes are not allowed in paths." };
  if (CONTROL.test(raw)) return { error: "Paths cannot contain control characters." };
  // Case-sensitive, exact segment comparison: ".." (and only "..") is the escape; "..data" is a name.
  const segments = raw.split("/").filter((s) => s !== "" && s !== ".");
  if (segments.includes("..")) return { error: "Paths with .. are not allowed; they could reach outside the grants." };
  const usable = (grants ?? []).filter((g) => g && typeof g.root === "string" && (forWrite ? g.kind === "folder" : true));
  const covered = usable.some((g) => {
    const root = g.root.split("/").filter(Boolean); // a "" folder grant covers the whole Files root
    if (g.kind === "file") return root.length === segments.length && root.every((seg, i) => seg === segments[i]);
    return root.every((seg, i) => segments[i] === seg); // segment prefix: the path is under the folder grant
  });
  if (covered) return { path: segments.join("/") };
  const listed = (grants ?? []).map((g) => `${g.root || "(Files root)"} (${g.kind})`).join(", ");
  return { error: `No grant covers that path. Paths are relative to the Files app root, not to a grant. Granted: ${listed || "nothing yet"}. The user can add grants in Settings.` };
}

/** NUL byte in the first 8 KB: the cheap, reliable binary marker for OPFS text. */
export function looksBinary(bytes) {
  const end = Math.min(bytes.length, 8192);
  for (let i = 0; i < end; i++) if (bytes[i] === 0) return true;
  return false;
}

/**
 * Read a file's bytes as bounded UTF-8 text.
 * @returns {{ text: string, size: number } | { error: string }}
 */
export function readText(bytes, name) {
  const ext = extension(name);
  if (ext === "pdf") return { error: "PDF files are not supported by read_file; use PDFCraft to work with PDFs." };
  if (!TEXT_EXTS.has(ext)) return { error: `Unsupported file type "${ext || "(none)"}"; read_file supports text files (txt, md, csv, json, html, xml, js, py and similar).` };
  if (bytes.length > MAX_READ_BYTES) return { error: `That file is ${Math.ceil(bytes.length / 1000)} KB; read_file supports at most ${MAX_READ_BYTES / 1000} KB.` };
  if (looksBinary(bytes)) return { error: `"${name}" looks like binary data; read_file supports text files only.` };
  let text;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { return { error: `"${name}" is not valid UTF-8 text; read_file supports text files only.` }; }
  return { text, size: bytes.length };
}

/** Confirmation text for write_file: path, size, first lines, and an explicit overwrite notice. */
export function writePreview(path, content, exists) {
  const size = new TextEncoder().encode(content).length;
  const lines = String(content).split("\n");
  return `Write ${exists ? "over" : "to"} "${path}" (${size} bytes, ${lines.length} line${lines.length === 1 ? "" : "s"})${exists ? " — this OVERWRITES the existing file" : ""}?\nFirst lines:\n${lines.slice(0, 3).join("\n")}`;
}
