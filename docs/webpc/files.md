# WebPC Files app

Files is a WebPC-native app at `/pc/apps/files/`: a breadcrumb file manager over the browser's own
[OPFS](https://developer.mozilla.org/en-US/docs/Web/API/FileSystemHandle/getDirectory) storage. Phase 1 is
self-contained; letting other apps open and save through Files is a later task.

## Storage scope (hard rule)

All reads, writes and deletes happen **only inside the `webpc-files/` directory at the OPFS root**, created on
first use. The wrapper in `src/scripts/pc/files/store.mjs` resolves every path by walking validated name
segments from that directory, so it cannot list, write or delete anything at the origin root. Other apps keep
their own OPFS roots (FilmCraft `recovery/` and `media/`, EffectCraft `effectcraft/`); the headless check keeps
sentinel entries at the root and asserts they survive a full use of the app.

Name rules (enforced in the pure `validateName` helper, unit-tested in `tests/pc-files.test.mjs`): non-empty,
at most 255 characters, no `/` or `\`, never `.` or `..`, no control characters. Rejections are shown in the
status line; uploads skip invalid names and say which ones.

If `navigator.storage.getDirectory` is unavailable, the app shows a clear message and disables its toolbar
instead of a broken UI.

## Features

- Breadcrumb path plus a list view (name, type, size, modified), folders first, then by name.
- New folder; upload through the Upload button (file input) or by dragging files from the OS (multiple files,
  with a progress line); download; rename; delete with a confirmation that counts the items a folder contains.
- A storage usage line from `navigator.storage.estimate()` and a **Keep my files** button that calls
  `navigator.storage.persist()` and reports the result.
- Keyboard: Enter opens the selected folder, Backspace goes up, Delete deletes (with confirm), F2 renames.
  Focusable rows with visible focus states.
- The page follows the desktop theme through the standard `pc:theme` message, and
  `pcBeforeClose` returns false only while an upload or delete is in flight.

## Known limits

- OPFS has no rename; the app renames by copy-then-delete, so a renamed file gets a new modified time.
- There is no size limit or quota pre-check; writes that exceed the quota fail with the browser's error, shown
  in the status line.
- Files exist only in this browser profile; closing the desktop or clearing browser data can remove them.
