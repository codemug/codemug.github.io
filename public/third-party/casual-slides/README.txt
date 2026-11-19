Actual CasualOffice Slides pre-workspace revision — Apache-2.0
https://github.com/CasualOffice/slides/tree/48397c257d8a67917990471f54a6e31bd15a51b4
Original LICENSE is preserved verbatim. BUNDLED-NOTICES.txt contains full
license/notice texts from dependencies contributing to the Vite bundle.
Univer 0.24.0 uses CasualOffice's original pnpm patches. WebPC additionally
applies a narrowly scoped build transform to docs-ui's rich-text resize hook:
its pending debounce/timer cancel when the render unit or React effect ends.
See scripts/pc/slides/docs-ui-lifecycle-fix.mjs for the exact modification.
The single blank initial slide and three missing UI support modules come from upstream commit
2762698ebbc2e2986ef2103798bdd21187182de2 (same Apache-2.0 license).

WebPC modifications: local fonts, disabled collaboration, snapshot autosave,
backup/recovery and host lifecycle bridge. No custom canvas/editor replacement.
See scripts/pc/slides/patch-upstream.mjs and upstream-host.ts, and
https://github.com/CasualOffice/slides for corresponding upstream sources.
Build: npm ci && node scripts/pc/prepare-slides.mjs (Node >=22.12 + git).
First preparation fetches the pinned source and frozen dependencies; runtime
needs no backend. Original font licenses are included alongside this file.
Legacy composer data remains untouched at pc:slides:v1 and is downloadable.
PPTX conversion is not lossless; unknown fonts use local substitutions.
