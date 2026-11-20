// Pure helpers for the Packet Viewer: capture magic detection, hex-dump formatting and
// base64 decoding of wiregasm data sources. No DOM, no engine — unit-tested directly.

// Magic signatures of the classic pcap global header (first 4 bytes) and the pcapng
// Section Header Block (magic number 0x0A0D0D0A, big-endian by definition).
const PCAP_MAGIC = [
  [0xd4, 0xc3, 0xb2, 0xa1, 'le', false], // 0xa1b2c3d4 little-endian, microseconds
  [0xa1, 0xb2, 0xc3, 0xd4, 'be', false], // 0xa1b2c3d4 big-endian, microseconds
  [0x4d, 0x3c, 0xb2, 0xa1, 'le', true], // 0xa1b23c4d little-endian, nanoseconds
  [0xa1, 0xb2, 0x3c, 0x4d, 'be', true], // 0xa1b23c4d big-endian, nanoseconds
];
const PCAPNG_SHB = [0x0a, 0x0d, 0x0d, 0x0a];

/**
 * Detect the capture format of a file's leading bytes.
 * @param {Uint8Array|number[]} bytes file bytes (at least the first 4)
 * @returns {{kind: 'pcap'|'pcapng'|'unknown', endian?: 'le'|'be', nanos?: boolean}}
 */
export function detectCaptureFormat(bytes) {
  if (!bytes || bytes.length < 4) return { kind: 'unknown' };
  if (bytes[0] === PCAPNG_SHB[0] && bytes[1] === PCAPNG_SHB[1] && bytes[2] === PCAPNG_SHB[2] && bytes[3] === PCAPNG_SHB[3]) {
    return { kind: 'pcapng' };
  }
  for (const [b0, b1, b2, b3, endian, nanos] of PCAP_MAGIC) {
    if (bytes[0] === b0 && bytes[1] === b1 && bytes[2] === b2 && bytes[3] === b3) {
      return { kind: 'pcap', endian, nanos };
    }
  }
  return { kind: 'unknown' };
}

const HEX = '0123456789abcdef';

/**
 * Format bytes as a classic hex dump: 8-digit offset, 16 hex bytes per line (extra space
 * after the 8th byte), ASCII gutter. Non-printable bytes render as '.'. An empty input
 * formats to the empty string.
 * @param {Uint8Array|number[]} bytes
 * @returns {string}
 */
export function formatHexDump(bytes) {
  if (!bytes || bytes.length === 0) return '';
  const cell = (row, i) => (i < row.length ? HEX[row[i] >> 4] + HEX[row[i] & 0x0f] + ' ' : '   ');
  const lines = [];
  for (let off = 0; off < bytes.length; off += 16) {
    const row = bytes.slice(off, off + 16);
    // Fixed-width field: 8 cells, a separator space, 8 cells — so short lines line up too.
    const hex = Array.from({ length: 8 }, (_, k) => cell(row, k)).join('') + ' ' + Array.from({ length: 8 }, (_, k) => cell(row, 8 + k)).join('');
    const ascii = Array.from({ length: 16 }, (_, i) => (i < row.length && row[i] >= 0x20 && row[i] <= 0x7e ? String.fromCharCode(row[i]) : '.')).join('');
    lines.push(off.toString(16).padStart(8, '0') + '  ' + hex + ' |' + ascii + '|');
  }
  return lines.join('\n');
}

/**
 * Decode a base64 string (as produced by wiregasm data sources) to bytes.
 * @param {string} b64
 * @returns {Uint8Array}
 */
export function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
