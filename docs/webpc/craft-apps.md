# Craft applications in WebPC

These are the official Storytold browser applications, not replacement editors. WebPC loads each app only when its window opens. The Rust/WASM editors, native tools, fonts, workers and file formats come from their release archives.

| App | Release | Route | Runtime assets (raw) |
| --- | --- | --- | --- |
| [LightCraft](https://github.com/storytold/lightcraft/releases/tag/v0.21.1) | 0.21.1 | `/pc/apps/lightcraft/` | about 51 MB |
| [FigCraft](https://github.com/storytold/figcraft/releases/tag/v0.18.1) | 0.18.1 | `/pc/apps/figcraft/` | about 25 MB |
| [PDFCraft](https://github.com/storytold/pdfcraft/releases/tag/v0.21.1) | 0.21.1 | `/pc/apps/pdfcraft/` | about 74 MB, including lazy OCR models |
| [SoundCraft](https://github.com/storytold/soundcraft/releases/tag/v0.20.1) | 0.20.1 | `/pc/apps/soundcraft/` | about 19 MB |

## Prepare and update

Run `npm ci` and `node scripts/pc/prepare-craft.mjs`, or use the normal `npm run dev` / `npm run build` pipeline. Preparation needs Node, network on first use, and `unzip`. No Rust build, private checkout, sibling repository or absolute browser path is needed.

`scripts/pc/craft/releases.mjs` pins the release versions, official GitHub URLs and SHA-256 digests. ZIPs cache under ignored `node_modules/.cache/webpc/craft/`. Each ZIP is verified before extraction; unsafe archive paths are rejected. Staging finishes before replacing generated `public/pc/vendor/{app}/`. The marker includes the checksum and integration fingerprint. Update the pins only after reviewing the matching source tag, storage/host contracts, licenses and browser regressions.

The archive's JS/WASM/assets remain unchanged. We add `webpc-bootstrap.js` before startup and an identifying HTML attribute. Unused `.gz`/`.br` siblings and hosting-specific header templates are omitted; ordinary static hosting serves the original files. Full upstream Apache/MIT notices, font licenses, SoundCraft attribution and PDF OCR model attribution/license texts are retained in the release and copied to `public/third-party/{app}/`. PDF OCR models have their own CC-BY-SA-4.0 license; they are unmodified.

## Files and storage

LightCraft uses its native browser library and automatic writes. It starts with upstream's clearly synthetic example photos; imported originals and edits are real library data. Use File → Back Up Library / Restore Library for portable ZIP backups. Image export is a normal download. Its web release cannot implement every desktop preset/curve file dialog.

**LightCraft storage isolation is enforced, including direct vendor URLs.** Its v0.21.1 `apps/lightcraft-web/src/backend.rs` opens the origin OPFS root by default, and `clear()` recursively deletes root entries. The entry script therefore always forces upstream's `store=idb` before initialization. That exact release uses database `lightcraft`, object store `files`; `workers.rs` propagates the selected backend to render workers. Its reset only clears that object store. Do not remove this guard or use default OPFS on WebPC's shared origin.

FigCraft stores its name and crash recovery under `figcraft.userName` and `figcraft.recovery`. PDFCraft stores preferences under `pdfcraft` (reads legacy `printcraft`); these are not document autosaves. SoundCraft has no persistent session or host bridge in v0.20.1. None of their reviewed web source resets the origin's storage.

The wrapper keeps one last **explicitly saved** document/session per app in its separate IndexedDB database `webpc-craft-saves-v1`, object store `files`: `.figcraft`/JSON, PDF, or `.scraftz`. Exports to unrelated formats never replace that recovery copy. Reopen saved is explicit. Changes since Save are not autosaved, and this is not a cloud backup. Native Save always triggers a real download, even when keeping its browser copy fails. Storage errors remain visible; the current bytes can be downloaded again or retried. Corrupt/invalid incoming files remain subject to native validation.

## Host and audio contracts

LightCraft, FigCraft and PDFCraft use their actual same-origin `?host=parent` ready/dirty/open/save messages. Listeners are installed before assigning iframe `src`. Every received message checks both `event.origin` and the exact editor window. `?control` enables upstream's documented command API for native browser regression tests. `?webgl` chooses the supported WebGL2 renderer without requiring WebGPU or cross-origin isolation headers.

SoundCraft starts empty (`?empty`), with audio suspended. Its upstream release already wraps AudioContext to resume on gestures; our earlier wrapper gates that resume and immediately suspends newly created contexts until **Enable audio**. Closing the WebPC window suspends all live contexts and requires explicit re-enabling on reopen. The shell keeps the same iframe/session cached. Reload requires a saved `.scraftz` bundle; a plain `.scraft` may not include media. No microphone permission is requested automatically, and the wrapper does not provide desktop plug-ins or recording input.

SoundCraft's native audio/MIDI/session import is driven through its actual file-drop path. Native session replacement calls `open_session_bytes`, which prompts before discarding dirty work. Its native download remains intact; a copy of `.scraftz` downloads goes to the wrapper's browser-save handler. Since this release has no dirty bridge, leaving/reloading an initialized SoundCraft page gets a conservative browser confirmation. Closing a cached WebPC window is allowed after suspending audio.

## Validation and limits

After building, run `npm run test:browser -- tests/browser/pc-craft.spec.mjs`. Tests use the installed Playwright Chromium with software WebGL, real native editors and file bytes. Coverage includes LightCraft import/edit/PNG export/ZIP backup/reload and reset isolation; FigCraft shapes, native save, recovery and quota failure; actual PDF text export/reopen; and SoundCraft nonzero audio output, media bundle export/reimport and audio suspension. Storage sentinels cover unrelated localStorage, another IndexedDB database and an OPFS root file.

These large canvas apps work best in maximized desktop windows. The wrapper fits small windows, but no touch-first redesign or full accessibility audit is claimed. Browser/GPU limits and large document memory use still apply. Online sharing or remote collaboration requires a separately configured compatible server; WebPC configures none. Optional native network features are user initiated. Keep important exports outside browser storage.
