# WebPC Docs

`/pc/apps/docs/` is a local document editor using the exact published
`@casualoffice/docs@1.4.2` React and core APIs, React/React DOM 19.3.1, and esbuild
0.27.7. It offers typing, formatting, headings, lists, images/links, DOCX
import/export, JSON backup/restore, title changes, browser print/PDF, and local
saving. The desktop loads the app only on launch. No server, login, AI, cloud
storage, collaboration, or remote font service is configured.

## Build and maintenance

`npm ci && npm run assets:pc` prepares ignored `public/pc/vendor/docs/`; dev and
build run this automatically. `node scripts/pc/prepare-docs.mjs` rebuilds just
Docs. The published runtime is bundled through public imports; upstream JS is
not patched, and no upstream submodules/workspace build are required. Both
`dist/styles.css` and `dist/react.css` are necessary. Preparation removes the
Google Fonts CSS imports and copies local fonts. The wrapper supplies the
`ep-root` utility scope, a minimal scoped button reset, and `white-space:pre-wrap`
for the SDK's portaled hidden ProseMirror input. Omitting that last rule loses
typed spaces in Chromium. The fonts remain locally available offline after
loading; there is no offline-service-worker install promise.

The editor bundle and lazy dialogs/fonts total approximately 6 MB uncompressed.
The exact size depends on generated chunks. Generated files are not committed.
Versions are pinned and checked by the preparation script; upgrading requires
reviewing the actual npm artifact, APIs, styles, licenses, and the browser tests.

## Integration and persistence

The public React `ref` is required for the SDK `onReady` handshake. Keep the
latest ref, because its methods capture document state. `onChange(document)`
saves its argument synchronously to `pc:docs:v1`; it does not reread a possibly
stale React ref. JSON encoding preserves Maps, Sets, Uint8Arrays, and
ArrayBuffers used by OOXML. `pcBeforeClose`/`pcFlush` return false on save
failure or a file operation in progress. An export's asynchronous serialization
does not suspend autosave, and finishing it flushes again.

The 1.4.2 `setContent` API updated the model but left the rendered paginated
surface stale in browser testing. Replacement therefore mounts a fresh keyed
editor and waits for readiness. New/Open confirm, retain the exact prior save
at `pc:docs:v1:previous`, then persist the new model. A failure restores the
previous editor; failed localStorage writes leave the existing primary value
intact. Corrupt startup data is not overwritten by autosave and can be downloaded
verbatim. Quota/storage failures are visible and JSON/DOCX export remains
available. Imports are limited to 10 MB; larger or image-heavy documents may
exceed localStorage quota much sooner than the file-size limit. Export regularly.

The trusted same-origin iframe posts `pc:ready`/`pc:focus`; theme messages check
both source and origin. Narrow frames fit the page initially and on width
changes, while the SDK zoom control allows enlargement. The host hides the SDK
app menus and panel rail; only its actual formatting toolbar remains. New/open,
exports, recovery, and print are supplied by the wrapper. Advanced menu-only
features are not advertised. A restrictive CSP blocks outbound fetches/fonts
and remote images; imported unknown fonts use available fallback fonts.

DOCX fidelity is partial. This is not a full Word replacement or real-time
collaboration service. Browser printing depends on the browser's print/PDF UI.
JSON is the most faithful backup of this editor's model; never use arbitrary
JSON documents as a substitute for the app's versioned backup format.

## Validation

```sh
npm test
npm run build
npm run test:browser -- tests/browser/pc-office.spec.mjs
```

The browser cases exercise real keyboard text (including spaces), bold,
immediate reload, desktop close/reopen, DOCX/JSON roundtrips, recovery, malformed
input, quota failure, edits during export, boot network failure, no external
requests in normal editing/export, and narrow layouts. This is Chromium
regression coverage, not a complete accessibility/cross-browser audit.

Licenses and attribution are under `public/third-party/casual-docs/`. The outer
Casual Office repository LICENSE/NOTICE and embedded editor MIT license are
preserved verbatim. The source reviewed was CasualOffice/docs commit
77e9530dc8ae9629399569fae4638214c39f48d3; runtime behavior is tested against the
pinned npm artifact, which can differ from repository HEAD.
