import test from 'node:test';
import assert from 'node:assert/strict';
import { detectCaptureFormat, formatHexDump, base64ToBytes } from '../scripts/pc/packets/helpers.mjs';

test('detectCaptureFormat: classic pcap magics (LE/BE, micro/nano seconds)', () => {
  assert.deepEqual(detectCaptureFormat([0xd4, 0xc3, 0xb2, 0xa1]), { kind: 'pcap', endian: 'le', nanos: false });
  assert.deepEqual(detectCaptureFormat([0xa1, 0xb2, 0xc3, 0xd4]), { kind: 'pcap', endian: 'be', nanos: false });
  assert.deepEqual(detectCaptureFormat([0x4d, 0x3c, 0xb2, 0xa1]), { kind: 'pcap', endian: 'le', nanos: true });
  assert.deepEqual(detectCaptureFormat([0xa1, 0xb2, 0x3c, 0x4d]), { kind: 'pcap', endian: 'be', nanos: true });
  // extra trailing bytes are ignored (the magic is only the first 4)
  assert.deepEqual(detectCaptureFormat(new Uint8Array([0xd4, 0xc3, 0xb2, 0xa1, 0x02, 0x00, 0x04, 0x00])), { kind: 'pcap', endian: 'le', nanos: false });
});

test('detectCaptureFormat: pcapng Section Header Block magic', () => {
  assert.deepEqual(detectCaptureFormat([0x0a, 0x0d, 0x0d, 0x0a]), { kind: 'pcapng' });
  assert.deepEqual(detectCaptureFormat(new Uint8Array([0x0a, 0x0d, 0x0d, 0x0a, 0x0b, 0x01, 0x00, 0x00])), { kind: 'pcapng' });
});

test('detectCaptureFormat: unknown and too-short inputs', () => {
  assert.deepEqual(detectCaptureFormat([0x00, 0x01, 0x02, 0x03]), { kind: 'unknown' });
  assert.deepEqual(detectCaptureFormat([0x50, 0x4b, 0x03, 0x04]), { kind: 'unknown' }); // zip
  assert.deepEqual(detectCaptureFormat(new Uint8Array([0xd4, 0xc3, 0xb2])), { kind: 'unknown' });
  assert.deepEqual(detectCaptureFormat([]), { kind: 'unknown' });
});

test('formatHexDump: empty input formats to the empty string', () => {
  assert.equal(formatHexDump(new Uint8Array(0)), '');
});

test('formatHexDump: one full 16-byte line, exact layout', () => {
  const line = formatHexDump(new Uint8Array(Array.from({ length: 16 }, (_, i) => i)));
  assert.equal(line, '00000000  00 01 02 03 04 05 06 07  08 09 0a 0b 0c 0d 0e 0f  |................|');
});

test('formatHexDump: partial second line with correct offset and ASCII gutter', () => {
  const bytes = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88, 0x99, 0xaa, 0x45, 0x46, 0x47, 0x48]);
  const [l1, l2] = formatHexDump(bytes).split('\n');
  assert.equal(l1, '00000000  48 65 6c 6c 6f 00 11 22  33 44 55 66 77 88 99 aa  |Hello.."3DUfw...|');
  assert.ok(l2.startsWith('00000010  45 46 47 48'));
  assert.ok(l2.endsWith('|EFGH............|'));
  // the second line is padded to the same hex-field width as a full line
  assert.equal(l2.length, l1.length);
});

test('formatHexDump: three lines for 37 bytes (16+16+5)', () => {
  const lines = formatHexDump(new Uint8Array(37).fill(0x2f)).split('\n');
  assert.equal(lines.length, 3);
  assert.ok(lines[0].startsWith('00000000'));
  assert.ok(lines[1].startsWith('00000010'));
  assert.ok(lines[2].startsWith('00000020'));
  assert.ok(lines[2].endsWith('|/////...........|'));
});

test('formatHexDump: only printable ASCII (0x20..0x7e) appears in the gutter', () => {
  const line = formatHexDump(new Uint8Array([0x00, 0x1f, 0x20, 0x7e, 0x7f, 0xff]));
  assert.ok(line.endsWith('|.. ~............|'));
});

test('base64ToBytes: known vectors and empty input', () => {
  assert.deepEqual([...base64ToBytes('SGVsbG8=')], [72, 101, 108, 108, 111]);
  assert.deepEqual([...base64ToBytes('AQID')], [1, 2, 3]);
  assert.deepEqual([...base64ToBytes('')], []);
});

test('base64ToBytes: round-trips Node-encoded base64 (engine data-source format)', () => {
  const bytes = new Uint8Array(71).map((_, i) => (i * 37) % 256);
  const b64 = Buffer.from(bytes).toString('base64');
  assert.deepEqual([...base64ToBytes(b64)], [...bytes]);
});
