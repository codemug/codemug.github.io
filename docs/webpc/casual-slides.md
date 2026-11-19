# CasualOffice Slides integration

`/pc/apps/slides/` embeds the actual [CasualOffice Slides application](https://github.com/CasualOffice/slides/tree/48397c257d8a67917990471f54a6e31bd15a51b4), pinned to commit `48397c257d8a67917990471f54a6e31bd15a51b4`. Its native canvas, menus, text/shapes, slide operations, presenter, and PPTX import/export run locally. The app is loaded only when launched.

This pre-workspace revision uses Univer 0.24.0 with CasualOffice's own checked-in pnpm patches, including its native text editor/focus/commit fixes. The older v0.1.0 tag predates those fixes. A newer development checkout (`2762698…`) switched to a source submodule that omitted them. We pin the last complete npm-based engine pipeline to retain those native editor fixes. Three referenced but missing upstream UI modules (BusyOverlay, UniverBootSplash, AutosaveRestoreBanner) and the single blank initial slide are preserved from `2762698ebbc2e2986ef2103798bdd21187182de2`, also Apache-2.0. The support modules are copied verbatim under `scripts/pc/slides/upstream-support/`. No demo deck is loaded as user data.

## Reproduction

Run `npm ci`, then `node scripts/pc/prepare-slides.mjs`. This also runs through `npm run assets:pc` before normal dev/build. Requires Node >=22.12, git, and network on first preparation. The script fetches the exact Git commit into ignored `node_modules/.cache/webpc/casual-slides/`, installs the upstream frozen lock using exact pnpm 10.33.4 with lifecycle scripts disabled, applies exact-match integration patches, and builds Vite. Upstream's pnpm dependency patches still apply. Generated assets live in ignored `public/pc/vendor/slides/`; a source fingerprint avoids repeated builds. After manually regenerating assets, restart an already-running Astro dev server so its public-file map includes new hashed filenames.

To update, review the source revision and lock, adapt guarded matches in `scripts/pc/slides/patch-upstream.mjs`, then run unit/browser regressions. Do not silently fall back to a different editor. The main JS is about 4 MB before compression; the full assets include PPTX worker, lazy dialogs and hyphenation dictionaries.

## Integration seam and data

The wrapper calls our pinned `window.webpcSlides` bridge inside the same-origin iframe. `pcBeforeClose`/`pcFlush` synchronously save a complete snapshot, including imported OOXML resources and media. Mutation events and native input events save changes; a live text editor draft is overlaid on the saved copy without ending editing. Failure remains visible and blocks closing an initialized unsaved editor. A failed initial load can close safely. Imported/New decks preserve one prior snapshot before replacement and require confirmation. JSON is validated before it can replace anything.

Storage uses `pc:casual-slides:v1` and `:previous`. The earlier custom composer's `pc:slides:v1` is never overwritten or removed. A banner downloads that exact legacy JSON; its incompatible format is not silently migrated. The browser save is quota limited, device specific, and not a cloud backup. Important presentations should also be exported as PPTX or JSON. Corrupt startup data is left untouched until explicit replacement.

Upstream code/licenses are preserved under `/third-party/casual-slides/`; bundled dependency texts are generated from Vite's actual module list. Fonts are self-hosted Inter, Material Symbols and metric-compatible office families. No Google Fonts/CDN or collaboration backend is used. Unknown fonts fall back locally. PPTX conversion is not lossless; unsupported features and fonts may change. Native speaker notes and other PPTX features remain subject to upstream conversion support. The native editor remains light themed; the WebPC wrapper follows the shell theme.

## Verification

`npm test` includes native snapshot/OOXML/media backup validation. After `npm run build`, run `npm run test:browser -- tests/browser/pc-slides.spec.mjs`. Tests drive actual native canvas typing and menus, import an editable text+image PPTX, reload, export and inspect its ZIP, exercise local recovery/errors and preserve legacy data. No sibling checkout or fixed browser executable is required.

The host corrects one pinned upstream focus defect: EditorService cached the text-editor unit ID while DOM focus moved to the canvas, then skipped re-focusing on double-click. A guarded call to the existing editor's focus method restores editing without replacing the engine or losing undo. The regression includes styling, adding a slide, Undo, and editing again. Narrow windows retain native slide navigation and horizontally scrollable controls, with a fit zoom; the native format pane overlays the canvas when open. Partial-text formatting remains an upstream limitation; whole-frame formatting is tested.

The pinned Univer rich-text resize hook also left its 30 ms scrollbar debounce and 500 ms resize timer alive after its render unit was disposed. `docs-ui-lifecycle-fix.mjs` applies an exact-match Vite transform to that hook, registering cancellation with the render unit and React cleanup. It does not suppress browser errors or alter editing behavior. The browser regression asserts zero page errors through native typing, formatting, slide insertion, Undo and re-entry.
