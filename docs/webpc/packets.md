# Packet Viewer in WebPC

`packets` — "Packet Viewer" — at `/pc/apps/packets/`. Fully local: Wireshark 4.6's
dissectors run as WebAssembly (via wiregasm 2.0.0) inside a Web Worker; captures are
read into memory, never stored or sent anywhere. The ~21 MB engine loads only when the
user opens a file or clicks "Load engine", with a live progress line.

## Prepare and update

Run `node scripts/pc/prepare-packets.mjs` (the report provides the exact `assets:pc`
line; it comes after the other preparers). The preparer is self-contained — wiregasm is
**not** in `package.json` (lead ruling): it downloads the pinned tarball, verifies the
pinned sha512 `dist.integrity`, rejects unsafe archive paths, extracts with the system
tar, and keeps the tarball + extracted package out of the shipped output.

| Item | Detail |
|---|---|
| Package | `@goodtools/wiregasm` 2.0.0 (GPL-2.0-or-later) |
| Tarball | `https://registry.npmjs.org/@goodtools/wiregasm/-/wiregasm-2.0.0.tgz` |
| Integrity | `sha512-pAt6nckRGu8A1EDO0c0n6sXDtIZGLAWDdeeKiQDwtFxOP1RvKmyNE3okFKJkC9ex0/x2afuvYYMGWJCxepku/w==` |
| Upstream | `https://github.com/good-tools/wiregasm` |

The preparer ships only `wiregasm.wasm.gz` (19.5 MB) and `wiregasm.data.gz` (433 KB) —
the raw 73 MB wasm and 2.6 MB data are **not** shipped. The worker inflates them in the
browser with `DecompressionStream('gzip')` and hands the bytes to the emscripten loader
via `wasmBinary` + `getPreloadedPackage`, so the loader makes **zero** runtime fetches.
The app sources (`scripts/pc/packets/main.mjs`, `worker.mjs`, `helpers.mjs`) are
esbuild-bundled (`app.js` ESM + `worker.js` IIFE, minified), with the wiregasm package
aliased into the staged tarball. `public/pc/vendor/packets/` is 21 MB total.

## App behaviour

- **File in**: file input or drag-and-drop; magic bytes decide (classic pcap LE/BE,
  micro/nano, and pcapng SHB), not the extension. Unrecognized files get a visible
  error and are not loaded.
- **Packet list**: columns No., Time, Source, Destination, Protocol, Length, Info
  (from `wg.frames`, capped at 1000 rows; the status line says so when truncated).
- **Selection**: click a row → protocol tree (text only) + hex dump of the packet's data
  sources (offsets, hex, ASCII gutter).
- **Display filter**: box + Apply; `testFilter` first — invalid filters show the engine's
  error visibly; valid filters re-query the table. The status line reports
  `N packets match filter "f"`.
- **Theme**: vendor page reads `packets:theme` from localStorage and follows `pc:theme`
  messages; the wrapper forwards its theme and polls `window.webpcPackets`.
  `pcBeforeClose` is a no-op — captures live only in memory.

## What WebPC enforces

- **Zero network traffic**: everything is same-origin. Verified by the headless check:
  all 12 requests in the whole run (light + dark) hit `localhost:4322`; 0 non-localhost.
- **Text-only rendering**: dissector output via `textContent`; the UI is built with
  `createElement`, no `innerHTML` anywhere.
- **CSP** (vendor `index.html`): `default-src 'self'; worker-src 'self' blob:; connect-src 'self'`.
  No inline styles/scripts; worker is a same-origin file (CSP-allowed).
- **SharedArrayBuffer**: not needed. The engine is single-threaded (0× `SharedArrayBuffer`,
  0× `Atomics` in the loader); no COOP/COEP headers required.
- **Storage (BRIEF rule 6)**: no `localStorage.clear`/`sessionStorage.clear`, no
  `indexedDB.deleteDatabase`, no `navigator.storage.getDirectory`. The only keys touched
  are `packets:theme` (vendor) and the desktop's `theme` (wrapper). No origin-wide wipe.

## GPL compliance

`public/third-party/packets/` holds the package's `LICENSE` (full GPL-2.0-or-later text)
and `WEBPC.txt` naming the source of the corresponding source: the published npm tarball
(sha512-pinned) and the upstream repo at the matching version. The worker sniffs the
gzip magic before inflating (the local dev server transparently decodes `.gz` via
`Content-Encoding: gzip`); no other tweaks.

## Validation

- `node --test tests/pc-packets.test.mjs` — 10 tests for the pure helpers: capture magic
  detection (pcap LE/BE, micro/nano, pcapng, unknown/too-short), hex-dump formatting
  (fixed-width lines, offsets, ASCII gutter), base64 decode (known vectors + round-trip).
- Headless check (a Playwright script against the dev server, not committed): 0 non-localhost requests on load; fixture
  (1 Ethernet/IPv4/UDP/DNS packet for `example.com`) loads with protocol DNS; selecting
  the packet shows `example.com: type A, class IN` in the tree; filter `udp` keeps it,
  `tcp` hides it; a bogus filter shows the engine's error visibly. Light and dark screenshots
  of the page and its wrapper were reviewed.

**Status: run — all checks pass; vendor is 21 MB.**
