# Local Sheets app

The `/pc/apps/sheets/` Astro route embeds the **published, prebuilt** Casual
Sheets **0.20.0** SDK. This is a browser-only workbook editor; there are no
accounts, server saves, collaboration services, CDN scripts, or remote fonts.
The desktop loads it only when Sheets is launched. Its worker files are local.

## Build and update

`npm ci` installs the exact SDK and Fontsource versions from package-lock.json.
`npm run assets:pc` copies the four SDK runtime/worker bundles plus the small
host bridge and local fonts into ignored `public/pc/vendor/sheets/`. Both
`npm run dev` and `npm run build` run that command automatically. The script
checks SDK 0.20.0 explicitly and does not compile the upstream fork/submodules.
The 1.5 KB `blank.xlsx` is an authored, empty OOXML bootstrap workbook; saved
content is subsequently supplied by the host. Do not use a user's spreadsheet
as this template.

The editor and workers total about **25 MB uncompressed / 6 MB gzip**, before
fonts. Hosting determines transfer compression. These assets do not load when
visiting the ordinary blog or the unopened desktop. Generated assets should
not be committed. Font licenses are copied from the exact installed packages.

To update, pin a reviewed SDK version in package.json/lock, review the upstream
release and actual artifact, update the version check, and rerun all checks:

```sh
npm ci
npx playwright install --with-deps chromium
npm test
npm run build
npm run test:browser
```

For just the spreadsheet browser regressions after building:
`npm run test:browser -- tests/browser/pc-sheets.spec.mjs`.

## Adapter contract and limitations

The prebuilt iframe exports `mountEmbedded()` and exposes
`window.__casualEmbedApi` in its `onReady` callback. Upstream describes this
window property as an **introspection/debug seam**, so it is isolated and
validated in `adapter.mjs`, pinned, and covered by browser tests. The API methods
getContent/setContent/on/onMutation/importXlsx/exportXlsx are documented SDK
methods. `api.univer` is an upstream escape hatch without a semver guarantee;
we use its workbook editing methods to commit a pending cell before flushing.
An upgrade must test actual typed edits and reloads, not only programmatic API
changes. Bundled SDK files are copied verbatim, never patched.

The nested editor is same-origin and trusted. PostMessage checks both source
and origin. The outer app posts `pc:ready` only after workbook initialization,
relays nested pointer focus as `pc:focus`, and accepts `pc:theme` from its parent.
The shell calls `pcBeforeClose()` synchronously; false means saving failed and
the shell must keep the app visible. The desktop also caches closed/minimized
iframes, preserving pending work. `pcFlush()` is the same hook.

Autosave uses localStorage key **pc:sheets:v1**; replacement retains one prior
workbook at **pc:sheets:v1:previous**. This intentionally uses synchronous atomic
writes for reload/close safety. The mutation hook saves in a microtask rather
than waiting for the SDK's 400 ms change debounce. Formula recalculations and
programmatic changes also save. localStorage has a small browser-specific
quota; errors remain visible, refuse close, and leave the previous save intact.
JSON export remains available. Corrupt existing saves are never replaced by
blank autosave. New/Open require explicit confirmation and preserve recovery
before replacing; failed import or save restores the in-memory previous book.
Browser data deletion still removes saved work. This is not a cloud backup.

Formats: app-specific JSON snapshot backup/restore and XLSX import/export, up
to 20 MB input. CSV, ODS, macros, external workbook links, chart/pivot/sparkline
roundtrip and full Excel compatibility are not advertised. Chart/pivot/sparkline
controls are disabled via SDK features; chart/pivot rail buttons also have
version-pinned CSS selectors because the SDK's panel registry ignores features.
The History/Activity rail is hidden too: integration testing found it did not
record real formula-bar edits. Undo/redo remain available; the local edition
does not promise an activity feed or persistent version history.
File/Help host menu entries are hidden; our wrapper supplies those actions.
Native formatting, sort, validation, find/replace and other built-in SDK dialogs
remain available. The host defensively reports unexpected dialog requests.

## Attribution

Upstream source reviewed at commit
`87a63902d94c85b3c50d3210055373a3d3bae991`:
https://github.com/CasualOffice/sheets/tree/87a63902d94c85b3c50d3210055373a3d3bae991

`public/third-party/casual-sheets/LICENSE` and `NOTICE` are copied **verbatim**
from that source. Its metadata declares Apache-2.0; the upstream LICENSE has
nonstandard section 6 wording, so we preserve the actual text. All bundled
license comments stay in the unmodified JS artifacts. Supporting dependency
and font licenses are alongside those files. The app's Help links attribution.

## Window/canvas resizing

The 0.20.0 renderer's internal ResizeObserver schedules `engine.resize()` using
`requestIdleCallback` without a deadline. In the embedded desktop, the container
and iframe could grow while the canvas stayed at its initial 999×355 size;
a synthetic window resize event did not help. The adapter's `watchViewport`
observes the actual canvas parent and root, then coalesces changes into one
`requestAnimationFrame` and calls the existing engine's `resize()`.

Access is pinned and guarded: Univer's `_getSheetRenderComponent(workbookId,
'__SpreadsheetRender__').getScene().getEngine()`. This is a private facade seam,
so upgrades must verify it. The runtime bundle remains verbatim. The observer
resolves the active engine again when a new workbook installs a canvas, ignores
zero-sized hidden windows, and disconnects on final page exit. It never calls
setContent, reloads an iframe, or replaces workbook/scene state for resizing.

Browser regressions compare CSS canvas size, backing-store size, and container
size through maximize/restore/pointer resize, minimize/reopen, and narrow
portrait/landscape at device scale factor 2. They click and edit M20 beyond both
old canvas bounds, verify the workbook ID/content, and retain undo/redo history.
