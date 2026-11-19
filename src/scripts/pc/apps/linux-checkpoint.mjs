// Portable, bounded checkpoint envelope. VM gzip payload is validated in its worker.
export const MAX_STATE_BYTES = 768 * 1024 * 1024;
export const MAX_FILE_BYTES = 256 * 1024 * 1024;
export const MAX_HEADER_BYTES = 1024 * 1024;
const magic = new TextEncoder().encode('WPCVM001');
export function validateHeader(header, imageId) {
  if (!header || header.version !== 1 || header.imageId !== imageId) throw new Error('This checkpoint belongs to a different Linux image or format. Keep it with its original WebPC version.');
  if (!Number.isInteger(header.rawBytes) || header.rawBytes < 1 || header.rawBytes > MAX_STATE_BYTES) throw new Error('Invalid checkpoint memory size.');
  if (typeof header.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(header.sha256)) throw new Error('Invalid checkpoint checksum.');
  if (typeof header.screen !== 'string' || header.screen.length > MAX_HEADER_BYTES / 2) throw new Error('Invalid terminal screen.');
  if (!Number.isInteger(header.cols) || header.cols < 2 || header.cols > 1000 || !Number.isInteger(header.rows) || header.rows < 1 || header.rows > 1000) throw new Error('Invalid terminal dimensions.');
  return header;
}
export function packCheckpoint(header, payload) {
  validateHeader(header, header.imageId);
  const json = new TextEncoder().encode(JSON.stringify(header));
  if (json.length > MAX_HEADER_BYTES) throw new Error('Terminal history is too large to save.');
  const prefix = new Uint8Array(12); prefix.set(magic); new DataView(prefix.buffer).setUint32(8, json.length, true);
  const file = new Blob([prefix, json, payload], { type: 'application/octet-stream' });
  if (file.size > MAX_FILE_BYTES) throw new Error('Checkpoint exceeds the 256 MB backup limit. Export individual guest files or reduce memory use.');
  return file;
}
export async function unpackCheckpoint(file, imageId) {
  if (!(file instanceof Blob) || file.size < 15 || file.size > MAX_FILE_BYTES) throw new Error('Checkpoint is empty or exceeds 256 MB.');
  const prefix = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (magic.some((b, i) => prefix[i] !== b)) throw new Error('Not a WebPC Linux checkpoint. Legacy virtual files use Export legacy files.');
  const length = new DataView(prefix.buffer).getUint32(8, true);
  if (!length || length > MAX_HEADER_BYTES || 12 + length >= file.size) throw new Error('Invalid checkpoint header.');
  const header = validateHeader(JSON.parse(await file.slice(12, 12 + length).text()), imageId);
  return { header, payload: file.slice(12 + length) };
}
export async function decompressBounded(blob, expectedBytes) {
  if (!Number.isInteger(expectedBytes) || expectedBytes < 1 || expectedBytes > MAX_STATE_BYTES) throw new Error('Invalid checkpoint size.');
  const reader = blob.stream().pipeThrough(new DecompressionStream('gzip')).getReader();
  const chunks = []; let length = 0;
  try {
    while (true) { const { value, done } = await reader.read(); if (done) break; length += value.length; if (length > expectedBytes) throw new Error('Checkpoint expands beyond its declared size.'); chunks.push(value); }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  if (length !== expectedBytes) throw new Error('Checkpoint is incomplete.');
  return new Blob(chunks).arrayBuffer();
}
