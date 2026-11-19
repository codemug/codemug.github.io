# VERT in WebPC

`/pc/apps/vert/` embeds the actual VERT application, built from upstream commit [`35ebeb1679eb0b1af3f099c03060cb89f72e70f8`](https://github.com/VERT-sh/VERT/tree/35ebeb1679eb0b1af3f099c03060cb89f72e70f8). This is its real converter UI and engines, not a substitute format picker. Desktop files remain in the VERT frame; the wrapper does not upload or persist them.

## Reproduce the build

Use Node 22.12+, **Bun 1.3.14**, `tar`, and the repository's npm lockfile. `WEBPC_BUN_BIN` may point at the pinned Bun executable. The Pages workflow installs Bun 1.3.14 with a commit-pinned `oven-sh/setup-bun` action.

```
npm ci --ignore-scripts
node scripts/pc/prepare-vert.mjs
```

`npm run assets:pc` includes this command. Preparation verifies the pinned upstream source archive SHA-256 (`9bbe95a29176396fd17c02c817fad2d0b856c9477c6f5a7fd0aad982bcbe38ad`), applies the checked-in patches in `scripts/pc/vert/`, runs `bun install --frozen-lockfile --ignore-scripts`, and builds with the upstream frozen Bun lock. Inlang translation plugins are also pinned by exact version and SHA-256 in `scripts/pc/vert/inlang.json`; the upstream floating CDN imports are replaced with local files. Dependencies are fetched at build time. No floating dependency lock is generated.

Generated output lives in ignored `public/pc/vendor/vert/`; downloaded source and build dependencies live in ignored `node_modules/.cache/webpc/vert/`. The prepared static app is about **206 MiB**, plus notices and a roughly 2 MiB modified-source archive. The release manifest records the source pin, archive digest, build-input fingerprint, Bun version and translation plugins. Rebuilding unchanged inputs reuses the prepared output. Delete that vendor directory to force regeneration if an output file is damaged.

Production serves `/pc/vendor/vert/` and its clean subroutes from static directory indexes. The narrow `scripts/pc/vert/dev-plugin.mjs` middleware maps those directory routes to their existing index files in Astro development; it does not rewrite production routes or unrelated apps. HTTPS (or localhost) is required for service workers and relevant browser APIs.

## Local behavior and isolation

- Engines load on demand after opening VERT/adding a file. ImageMagick, Pandoc and single-threaded FFmpeg work in the non-isolated WebPC iframe. Mediabunny uses the browser's media capabilities. libvips, vectorization and threaded FFmpeg are not promised in this non-isolated environment; formats remain dependent on browser/engine support and available memory.
- `PUB_DISABLE_ALL_EXTERNAL_REQUESTS=true` is supplemented with guards around the upstream `useVertdSizeLimit` effect and `VertdInstance.url()`, which otherwise probe public conversion servers. Remote credits photos are omitted when this flag is set. The local CSP blocks external fetches, worker/media/image sources and frames. There is no remote upload fallback, analytics, payment service or automatic external image request. User-clicked external attribution links can open upstream sites.
- Every authored local/session storage access is namespaced with `pc:vert:`; the generated locale key is namespaced too. Privacy reset removes only those keys and VERT's converter cache. Other app data and the site's generic theme/settings/locale keys are preserved. Reset does not delete IndexedDB databases or unrelated caches.
- The cache service worker registers only at `/pc/vendor/vert/sw.js` with `/pc/vendor/vert/` scope. Its cache prefix is `pc-vert-wasm-cache`. It does not set COOP/COEP headers, force cross-origin isolation or reload the desktop to acquire isolation. Requests outside its scope and unrelated cache entries remain untouched.
- The wrapper waits for a source/origin-checked hydration handshake. It shows loading/failure/retry states, passes the desktop theme, forwards focus, and exposes Stop conversions. A missing vendor page fails visibly; slow initialization has a 90-second timeout.
- Minimize and idle close retain the iframe's files/results for this desktop session. Active conversion blocks close until the user stops it. Reload asks before discarding files. Browser reload/close loses the conversion session; download results to keep them. Native converters may use temporary browser storage, but this integration does not claim a durable file library. Closing an unfinished initial load cancels it and reopening retries.

## License and corresponding source

VERT is AGPL-3.0. The footer's source link and wrapper Help expose `/third-party/vert/modified-source.tar.gz`. Preparation creates that archive from the complete modified upstream source, its frozen lock, pinned translation modules and `WEBPC-BUILD.md` reproduction instructions; it excludes dependencies, generated build output and tool caches. This generated archive must be shipped with the static application. Source patches and preparation code remain in this repository.

`/third-party/vert/LICENSE`, `NOTICE.txt` and `DEPENDENCY-NOTICES.txt` preserve upstream and installed package notices (including build-only packages). Converter dependencies retain their own licenses: for example the locked `@ffmpeg/core` package identifies GPL-2.0-or-later; VERT's license does not replace those terms. Consult the frozen upstream lock and each dependency's source/license when changing or redistributing converter binaries. Do not hand-edit minified libraries or WASM.

## Verification

`tests/browser/pc-vert.spec.mjs` uses the real application and engines. It decodes PNG→JPEG dimensions and WAV→MP3 audio and opens the Markdown→DOCX package to verify document text. It also covers real conversion cancellation, invalid-input recovery, scoped reset with Docs/Slides/Sheets local data plus Linux/AI IndexedDB records and unrelated cache entries, zero external requests through initial load/conversion/Settings/About, service-worker scope, lazy desktop loading, failed-load retry, minimized/closed session reuse mobile resizing with a real conversion, clean-route/query hydration and interrupted-initial-load reopening.

These are targeted Chromium checks, not a claim that every supported format, Safari/Firefox, very large files or full accessibility has been audited. The integration owner runs the shared production build, unit tests and affected VERT/desktop browser cases after handoff. The unchanged pre-VERT baseline already passed its 59 browser cases; repeating that entire suite is not implied.
