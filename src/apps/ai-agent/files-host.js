// AI-2 browser glue for the Files tools: OPFS access through the shared Files store
// (webpc-files/ only) and the Files app's refresh channel. Pure path/text logic and
// validation live in file-tools.js and agent.js; grants are read live from `grants`.
import * as fileStore from "./store.mjs";
import { resolveInGrants, readText, writePreview, MAX_LIST_ENTRIES, MAX_WRITE_CHARS } from "./file-tools.js";
import { MAX_MESSAGE_CHARS } from "./storage.js";

const split = (path) => {
  const parts = path.split("/").filter(Boolean);
  return { base: parts.at(-1), parent: parts.slice(0, -1).join("/") };
};

/**
 * @param {{ grants: Array<{root: string, kind: 'folder'|'file'}>, confirm: (text: string) => boolean, note?: (text: string) => void }} host
 */
export function createFileHost({ grants, confirm, note = () => {} }) {
  // Same channel the Files app listens on, so an open Files page refreshes after a write.
  const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("webpc-files") : null;
  const list = async (raw) => {
    const resolved = resolveInGrants(grants, raw);
    if (resolved.error) return resolved;
    if (resolved.path) {
      const { base, parent } = split(resolved.path);
      const kind = await fileStore.exists(parent, base);
      if (kind !== "folder") return { error: `"${resolved.path}" is not a folder; list_files takes a folder inside your grants.` };
    }
    const items = await fileStore.list(resolved.path);
    const entries = items.slice(0, MAX_LIST_ENTRIES).map((item) => (item.kind === "folder" ? { name: item.name, kind: "folder" } : { name: item.name, kind: "file", size: item.size }));
    return { entries, truncated: items.length > MAX_LIST_ENTRIES };
  };
  const read = async (raw) => {
    const resolved = resolveInGrants(grants, raw);
    if (resolved.error) return resolved;
    const { base, parent } = split(resolved.path);
    const kind = await fileStore.exists(parent, base);
    if (kind === "folder") return { error: `"${base}" is a folder; use list_files.` };
    if (kind === null) return { error: `"${resolved.path}" does not exist inside the grants.` };
    const { data } = await fileStore.read(parent, base);
    const result = readText(new Uint8Array(await data.arrayBuffer()), base);
    if (result.error) return result;
    // Tool results are conversation messages, so keep the JSON below the store's per-message cap.
    const budget = MAX_MESSAGE_CHARS - 5_000;
    if (result.text.length > budget) return { text: result.text.slice(0, budget), size: result.size, truncated: true, note: `Only the first ${budget.toLocaleString()} characters were returned.` };
    return result;
  };
  const write = async (raw, content) => {
    const resolved = resolveInGrants(grants, raw, { forWrite: true });
    if (resolved.error) return resolved;
    if (typeof content !== "string" || content.length > MAX_WRITE_CHARS) return { error: `content must be a string of at most ${MAX_WRITE_CHARS} characters` };
    const { base, parent } = split(resolved.path);
    if (!base) return { error: "write_file needs a file name, not a folder." };
    const kind = await fileStore.exists(parent, base);
    if (kind === "folder") return { error: `"${base}" is a folder; write_file takes a file name.` };
    if (parent) {
      try { await fileStore.list(parent); } catch { return { error: `The folder "${parent}" does not exist yet; write_file cannot create folders.` }; }
    }
    const exists = kind === "file";
    if (!confirm(writePreview(resolved.path, content, exists))) return { error: "Write cancelled by the user." };
    const bytes = new TextEncoder().encode(content);
    await fileStore.write(parent, base, bytes);
    channel?.postMessage({ type: "changed" });
    note(`Wrote ${resolved.path} (${bytes.length} bytes)${exists ? " (overwritten)" : ""}.`);
    return { result: `Wrote ${resolved.path} (${bytes.length} bytes).`, overwritten: exists };
  };
  return { list, read, write };
}
