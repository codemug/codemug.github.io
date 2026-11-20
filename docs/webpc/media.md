# WebPC Media Player

The Media Player is a WebPC-native app at `/pc/apps/media/` for local audio and video, built on the
browser's own `<video>` element — no new dependency, no server.

## Open sources

- **Open…** — a file input (multiple, `audio/*,video/*`).
- **Drag and drop** — drop files anywhere on the player area.
- **Open from Files** — lists the audio and video files in the Files app's OPFS storage (`webpc-files/`,
  including subfolders) by **reusing `src/scripts/pc/files/store.mjs` read-only**: it only calls `list()`
  and `read()`, never writes, renames or deletes. Clicking a row plays it through a fresh object URL.

Files that are neither audio nor video (by MIME type, then extension) are skipped with a visible message.

## Player

- Playlist with previous/next, repeat **off / all / one**, and per-item removal; the current item is
  highlighted. The playlist is runtime-built, so its row styles live in a contained `<style is:global>`
  block (Astro scoped styles do not reach innerHTML-built rows — see the Files app).
- Transport: play/pause, seek bar, current time and duration, volume and mute. Volume is remembered in
  `localStorage 'pc:media:volume'`. Fullscreen for the stage.
- Keyboard: Space play/pause, ←/→ seek 5 s, ↑/↓ volume, N/P next/previous, M mute, F fullscreen, with
  visible focus states.
- `navigator.mediaSession` metadata plus play/pause/previous/next handlers, where supported.
- Unsupported codecs surface the `MediaError` code in the status line and the player skips to the next
  item.
- Object URLs are revoked when their item is removed or the playlist empties.

## Closing behaviour

Closing a WebPC window only **hides** its iframe (`desktop.js`), so a naïve close would keep audio playing.
`window.pcBeforeClose` therefore **pauses playback and returns true**, and playback also pauses on
`pagehide`. The theme follows the desktop's `pc:theme` message and both themes are verified.
