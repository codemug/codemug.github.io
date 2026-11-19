# WebPC Casual Slides

This route now embeds the **actual CasualOffice Slides application**, pinned to
`48397c257d8a67917990471f54a6e31bd15a51b4`. It replaces the earlier custom
composer. Native canvas editing, slide operations, and PPTX import/export come
from upstream. Existing composer storage is preserved and downloadable.

See [integration, reproduction, storage and limitations](../../../docs/webpc/casual-slides.md).

Prepare with `node scripts/pc/prepare-slides.mjs` (also part of `assets:pc`).
The pinned source uses pnpm 10.33.4, an apps/* workspace, a frozen lockfile,
and upstream's original Univer 0.24.0 patches. No engine patches are authored
here. `patch-upstream.mjs` applies guarded host/font/validation changes.
`upstream-host.ts` owns local persistence and the WebPC lifecycle bridge.
`upstream-support/` preserves three missing upstream UI files verbatim from
commit2762698ebbc2e2986ef2103798bdd21187182de2 under Apache-2.0.

Tests: `npm test`; after a production build,
`npm run test:browser -- tests/browser/pc-slides.spec.mjs`.
