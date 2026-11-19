# Static web apps in WebPC

Prebuilt single-page web apps, integrated unmodified (or with a documented per-app tweak) into WebPC as same-origin iframes under `/pc/apps/<id>/`. Unlike the Craft apps, these are ordinary static bundles: no WASM toolchains, no entry-script bootstrap, no host message bridge.

| App | Release | Route | Runtime assets (raw) |
| --- | --- | --- | --- |
| [SQLiteViz](https://github.com/lana-k/sqliteviz/releases/tag/0.32.1) | 0.32.1 | `/pc/apps/sqliteviz/` | about 4 MB |

## Prepare and update

Run `node scripts/pc/prepare-static-apps.mjs` (also wired into `assets:pc`). The script is table-driven: each row in `staticApps` pins `id`, `version`, `url`, `upstream`, `sha256`, a `notice` (the WEBPC.txt body) and an optional `tweak` function. BeepBox and Excalidraw will be added as further rows; the table is the extension point.

For each row: the ZIP caches under ignored `node_modules/.cache/webpc/static/<id>-<version>.zip`; the digest is verified before extraction; unsafe archive paths (absolute, backslash, `..`) are rejected (exported as `isUnsafeArchivePath`, unit-tested in `tests/pc-static-apps.test.mjs`). The ZIP is extracted to a staging folder, the payload (single top-level directory, or the zip root) is swapped into `public/pc/vendor/<id>/`, and a `.release.json` marker (version + sha256 + url) makes the run idempotent. `LICENSE`/`NOTICE` files are copied to `public/third-party/<id>/` alongside a `WEBPC.txt` stating version, upstream URL, release URL, SHA-256 and what WebPC changed.

## SQLiteViz 0.32.1 (Apache-2.0)

SQL queries and charts over SQLite/CSV/JSON/NDJSON files, fully client-side (sql.js WASM).

- **Bundle**: official Vite `dist.zip`, files at the zip root (no wrapper directory). All asset URLs are relative (`./assets/...`), so it serves from the `/pc/vendor/sqliteviz/index.html` sub-path with **no changes** — no per-app tweak was needed.
- **Routing**: vue-router hash history (`index.html#/workspace`, `#/inquiries`, `#/load`). The iframe src therefore points at the explicit `index.html` file (the dev server does not directory-index `public/` vendor folders).
- **Service worker**: the bundle ships a Workbox service worker (`service-worker.js` + `workbox-*.js`) registered at scope `/pc/vendor/sqliteviz/`. It precaches only its own assets and shows a "new version available" prompt on real updates. Left in place, unmodified.
- **Storage**: `localStorage` keys `myQueries` (saved queries) and `myInquiries` (versioned inquiries object); Vue-DevTools plugin settings under `__vue-devtools-plugin-settings__*` only when devtools are active; the cache API name `mapbox-tiles` is deleted only to evict its own map-tile cache. No IndexedDB, no `localStorage.clear`/`indexedDB.deleteDatabase`/`navigator.storage.getDirectory`. It opens files via `showOpenFilePicker` (user-initiated) and reads its bundled `inquiries.json` via a same-origin `fetch("./inquiries.json")`. **No origin-wide wipe; no scoping needed.**
- **Network**: initial load makes zero non-site requests (verified headless: 42 requests, all `localhost:4322`). No analytics, telemetry, update checks or CDN assets are bundled. The map chart view can fetch tiles and fonts from public map tile servers (OSM/MapLibre basemaps, `fonts.openmaptiles.org`, ArcGIS, ICGC) when the user creates a map — user-initiated data fetching, analogous to CyberChef's URL-fetch operations; noted on the app page.
- **Licence**: Apache-2.0; the bundle's `LICENSE` is copied to `public/third-party/sqliteviz/` with `WEBPC.txt`.

## Validation

`node --test tests/pc-static-apps.test.mjs` (table pinning + unsafe-path checks). Headless check `.lanes/scratch/web/check-sqliteviz.mjs` (scratch): loads `/pc/apps/sqliteviz/`, waits for the app UI, logs every non-localhost request (none), drives the UI with a 3-row CSV through the drop-zone picker and the CSV import dialog, runs `SELECT count(*) FROM rows` (result 3) and saves `.lanes/scratch/web/sqliteviz.png`. Note: bare `SELECT count(*)` with no `FROM` returns 1 in SQLite by design; the table must be named explicitly.
