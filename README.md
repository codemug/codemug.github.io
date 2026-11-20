# Usman Shahid's site

Static portfolio and technical blog at **https://usmanshahid.is-a.dev**. Built with Astro 6, MDX, Tailwind CSS 4, self-hosted Inter/JetBrains Mono, and native browser scripts. GitHub Pages serves the build; Giscus stores comments in GitHub Discussions.

## Development and checks

Use Node.js **22.12 or newer** and the committed npm lockfile. App-specific clean-build tools are listed below.

```sh
npm ci --ignore-scripts
npm run dev                # http://localhost:4321; includes draft posts
npm test                   # source/runtime regression tests
npm run build              # production output in dist/; excludes drafts
npm run preview            # inspect the production build locally
```

Browser checks require Chromium; see the illustration workflow below. The Pages workflow in [.github/workflows/deploy.yml](.github/workflows/deploy.yml) installs locked dependencies, runs unit tests, builds, checks Chromium regressions, and deploys `dist/` on pushes to `main` or manual dispatch. `astro build` is not a full TypeScript check.

## Routes and source of truth

- `/`: portfolio, experience, Primer, local posts and selected external writing; data lives in `src/pages/index.astro`.
- `/blog/` and `/blog/<slug>/`: articles from `src/content/blog/*.{md,mdx}`. The filename supplies the slug. Published articles currently include Primer and all six parts of the SRE LLM-deployment series.
- `/pc/`: the WebPC desktop; `/pc/apps/<app>/` contains its embedded application routes.
- `/rss.xml`, `/sitemap-index.xml`, and `/404.html`: feed, generated sitemap index, and error page.
- `src/layouts/Base.astro`: shared navigation, footer, metadata, theme and analytics. `src/styles/global.css`: dark/light design tokens and prose styles. Tailwind custom properties use explicit `var(...)`, e.g. `text-[var(--color-text-muted)]`.
- `src/components/Comments.astro` and `YouTubeGrid.astro`: comments and click-to-load video embeds. `src/components/illustrations/`: native figure and extracted deck runtimes.
- `src/components/tokenomics/` and `src/lib/tokenomics/`: Part 6’s calculator UI and calculation logic. Its published data is `public/data/tokenomics/`; see the [data preparation and calculation notes](scripts/tokenomics/README.md) before refreshing it.
- `public/`: assets copied directly to the build, including fonts, social cards, the CV PDF, `llms.txt`, domain and crawler configuration.

The site domain is set in `astro.config.mjs`, `Base.astro`, `public/CNAME` and `public/robots.txt`; keep these aligned if it changes.

## Writing and publishing

Create a Markdown/MDX file under `src/content/blog/` with `title`, `description`, and `pubDate`. Optional fields are `updatedDate`, `tags`, `draft`, `canonicalUrl`, `ogImage`, and `comments`; the schema is in `src/content.config.ts`. Drafts appear in development but not production pages or RSS. Set `canonicalUrl` only when another site is the original publisher. Per-post social images resolve in this order: explicit `ogImage`, `public/og/<slug>.png`, then `public/og-image.png`. `npm run og` generates cards; review the output before publishing.

The published source of truth is `src/content/blog/`. The SRE series now covers transformer mechanics (Part 1), training and serving (Part 2), hardware and engines (Part 3), model deployment (Part 4), routing/observability/autoscaling (Part 5), and tokenomics (Part 6). Parts 3–6 include deck figures; Part 6 also includes the interactive cost calculator. Infrastructure examples and calculator estimates depend on their documented versions and assumptions; a site build does not validate an external deployment or benchmark.

Author workspaces may contain root drafts, illustration briefs, crosspost drafts, planning documents, model research, and the original `deck.html`. These are separate from the published article and figure inputs and are not required for an ordinary checkout to build. Keep such untracked author material intact. Crosspost drafts are not synchronized automatically: review prose, image placeholders, and custom-domain canonical URLs before reuse.

## Illustration workflow

Published figures live under `src/components/illustrations/`; MDX imports the relevant native or deck runtime. The deck manifest, base CSS and extracted slides are checked-in build inputs. Ordinary builds and tests do not require the original talk deck.

```sh
npx playwright install --with-deps chromium
npm run build
npm run test:browser
```

The browser config at `scripts/qa/playwright.config.mjs` starts and stops a local preview on port 4325. Source extraction tests always use the representative `tests/fixtures/deck-source.html`; a locally available root `deck.html` also enables integration checks. The fixture covers extraction regressions, not reconstruction of the complete original deck.

To regenerate every deck slide, obtain the original authoring deck and run:

```sh
node scripts/extract-deck.mjs /path/to/original/deck.html
npm test
npm run build
npm run test:browser
```

The full original deck is not bundled with the tracked source, so full regeneration requires that external input. Preserve its provenance when handing it off. Put generated-slide fixes in `scripts/extract-deck.mjs` so regeneration retains them; shared animation behavior lives in `deck-runtime.js`. Inspect generated diffs and browser behavior before publishing. Editing an archived root draft does not regenerate figures.

## WebPC desktop

The Craft apps (LightCraft, FigCraft, PDFCraft, SoundCraft, GridCraft, DeckCraft, FilmCraft, CADCraft, VectorCraft, PhotoCraft, EffectCraft, MaterialCraft and TextureCraft) use pinned official browser releases. [Craft integration notes](docs/webpc/craft-apps.md) describe preparation, native formats, storage isolation and audio behavior.

`/pc/` is a full-height browser desktop, linked from the site navigation. Desktop icons open with a double-click, Enter, or one tap on touch screens. Apps can also launch from the taskbar. Windows support pointer and keyboard movement/resizing, stacking, minimize/restore, and maximize; narrow screens use fullscreen windows above the taskbar.

Add a working app entry in `src/scripts/pc/registry.mjs`, an SVG in `src/components/pc/AppIcon.astro`, and its same-origin route under `/pc/apps/`. The shell loads an iframe only on first launch and keeps it alive when minimized or closed so pending saves can finish. Each app owns durable storage. A synchronous `window.pcBeforeClose()` hook can return `false` to prevent closing when saving fails. The message contract and design decisions are in [the WebPC design notes](src/components/pc/DESIGN.md).

`src/scripts/pc/window-state.mjs` is the DOM-free window model; `desktop.js` renders existing app frames without resetting them. Shell coverage lives in `tests/pc-window-state.test.mjs` and `tests/browser/pc-desktop.spec.mjs`. Browser shell tests use a tiny substitute app to isolate window behavior; real spreadsheet integration is tested separately. Local saves belong to this browser/device and are not a cloud backup.

## Contact

- [Email](mailto:u.manshahid@gmail.com)
- [LinkedIn](https://linkedin.com/in/u-manshahid)
- [Medium](https://medium.com/@usmanshahid)

### WebPC developer tools

The launcher searches app names, descriptions, categories, and keywords. `/pc/` and the existing `pc:*` data/message keys remain unchanged by the WebPC rename.

- **CyberChef 11.5.0** uses the actual upstream static release. `assets:pc` verifies the pinned SHA-256 and extracts it with `unzip` (required on the build machine). First clean build downloads 83 MB from GitHub Releases; later builds reuse ignored assets/cache. Source ZIP and generated bundles are not committed. The largest shipped file is 13.6 MB; check the total `dist/` size against [Pages' 1 GB site limit](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits) when adding more apps. Licenses and notices are preserved under `/third-party/cyberchef/` and beside bundled JS. Recipes/output use CyberChef's own save/download controls. A wrapper-only pane selector makes Operations, Recipe, Input, and Output accessible on narrow screens without modifying the upstream release.
- **Terminal** boots real 32-bit Alpine Linux in a v86 worker, with Bash, coreutils, Python, Node.js and nano. The guest is offline; no public relay, SSH backend, or host-file access is supplied. Start/Pause/Restart and explicit IndexedDB save/restore/export preserve real guest memory and files. The old `pc:terminal:v1` data stays untouched and can be exported from Help. Clean asset preparation requires Docker + Python 3; the generated ~154 MB guest is served statically and loaded on demand. See [Linux Terminal reproduction, limits, and source provenance](docs/webpc/linux-terminal.md).
- **GridCraft 0.19.1** is the pinned official Storytold spreadsheet editor (Rust/WASM) at `/pc/apps/gridcraft/`: it creates and edits XLSX, CSV and ODS workbooks and exports PDF. It takes over the grid role the removed Sheets app had. The same-origin `?host=parent` bridge supplies ready/dirty/open/save, and the wrapper keeps the last explicitly saved workbook (`.xlsx`) in its own IndexedDB database. Clean preparation needs Node, network on first use and `unzip`; the ~25 MB runtime loads when the window opens. See [Craft integration notes](docs/webpc/craft-apps.md).
- **DeckCraft 0.18.1** is the pinned presentation editor at `/pc/apps/deckcraft/`: it builds decks, opens PPTX/POTX/PPSX and exports PDF, pictures, outline, GIF and handouts. It takes over the role of the removed Slides app; a plain Save writes the deck in its own format and the wrapper keeps the last presentation (`.deckcraft`/`.pptx`). Same pinned-release preparation; ~32 MB. See [Craft integration notes](docs/webpc/craft-apps.md).
- **FilmCraft 0.20.1** is the pinned video editor at `/pc/apps/filmcraft/`: it edits video, audio and stills on a timeline, with a crash-recovery journal and imported media in its own OPFS entries. Every host save downloads; the wrapper keeps a `.fcproj` project as the recovery copy. Same pinned-release preparation; ~48 MB. See [Craft integration notes](docs/webpc/craft-apps.md).
- **CADCraft 0.20.1** is the pinned drafting app at `/pc/apps/cadcraft/`: it opens and edits DXF and DWG and exports SVG and other formats. Preferences live in localStorage; the wrapper keeps the last `.dxf`/`.dwg` as the recovery copy. Same pinned-release preparation; ~30 MB. See [Craft integration notes](docs/webpc/craft-apps.md).
- **VectorCraft 0.24.1** is the pinned vector-illustration editor at `/pc/apps/vectorcraft/`. It runs in **standalone mode** (its web build ships no host bridge), so the wrapper loads `?webgl&standalone` and opens files through the app's own documented `openFile` control channel. Preferences are in localStorage; up to 16 saved files live in WASM memory. Same pinned-release preparation; ~100 MB, the largest Craft runtime. See [Craft integration notes](docs/webpc/craft-apps.md).
- **PhotoCraft 0.23.1** is the pinned layered photo/image editor at `/pc/apps/photocraft/` (PSD). It runs in **standalone mode** and opens files through a drop onto the canvas; preset libraries persist in its own IndexedDB database, and `prepare-craft.mjs` patches its 0.23.1 snippets path. Same pinned-release preparation; ~16 MB. See [Craft integration notes](docs/webpc/craft-apps.md).
- **EffectCraft 0.24.1** is the pinned compositing editor at `/pc/apps/effectcraft/`: video, audio and images with effects and motion graphics. It runs in **standalone mode** (documented `addFile` agent API for opens) and keeps its session and media in its own OPFS with an IndexedDB fallback; the wrapper loads it with upstream's `?nosw`. Same pinned-release preparation; ~73 MB. See [Craft integration notes](docs/webpc/craft-apps.md).
- **MaterialCraft 0.4.1** is the pinned shader-graph editor at `/pc/apps/materialcraft/` for game-engine materials (SBS). It runs in **standalone mode** and persists only localStorage preferences. Same pinned-release preparation; ~14 MB. See [Craft integration notes](docs/webpc/craft-apps.md).
- **TextureCraft 0.6.1** is the pinned texture tool at `/pc/apps/texturecraft/`: baking and authoring textures for 3D meshes (UV, PBR). It runs in **standalone mode** and persists only localStorage preferences. Same pinned-release preparation; ~20 MB. See [Craft integration notes](docs/webpc/craft-apps.md).
- **SQLiteViz 0.32.1** is the pinned [release](https://github.com/lana-k/sqliteviz/releases/tag/0.32.1) served unmodified at `/pc/apps/sqliteviz/`: it queries and charts CSV and SQLite data locally. The pinned SHA-256 is verified before extraction; ~4 MB. See [static web apps](docs/webpc/static-apps.md).
- **BeepBox 4.2.2** is the pinned [chiptune tracker](https://github.com/johnnesky/beepbox/releases/tag/v4.2.2), integrated unmodified at `/pc/apps/beepbox/` (~1.8 MB, same pinned-release preparation). See [static web apps](docs/webpc/static-apps.md).
- **Excalidraw 0.18.1** is the hand-drawn diagram editor, bundled locally from the pinned npm package (devDependency + lockfile integrity): a production esbuild bundle, a CSP-locked page and self-hosted fonts — no CDN, share or collaboration backends. Prepared with `node scripts/pc/prepare-excalidraw.mjs`; no external download at build time. See [Excalidraw in WebPC](docs/webpc/excalidraw.md).
- **Files** is a WebPC-native file manager over the browser's own OPFS, hard-scoped to the `webpc-files/` directory. It is the cross-app file bridge: the Craft wrappers' **Open from Files** and **Save copy to Files**, and the Media Player's picker, talk to it same-origin with no broker, and changes broadcast on `BroadcastChannel('webpc-files')`. No external assets. See [Files](docs/webpc/files.md).
- **Media Player** is a WebPC-native audio/video player built on the browser's own `<video>` element (no new dependency): file input, drag-and-drop, and **Open from Files**, read-only over the Files app's storage. No external assets. See [Media Player](docs/webpc/media.md).
- **Network Tools** is a WebPC-native set of network and security tools at `/pc/apps/nettools/`: local subnet calculation, DNS-over-HTTPS, domain/IP lookups (RDAP, crt.sh, Shodan InternetDB), keyless Globalping, latency, and local password strength (zxcvbn) plus `age` file encryption. Pinned npm dependencies are esbuild-bundled at preparation; lookups reach their public services only when you run them. See [Network and Security Tools](docs/webpc/nettools.md).
- **Packet Viewer** inspects pcap and pcapng captures fully locally at `/pc/apps/packets/`: Wireshark 4.6's dissectors run as WebAssembly (wiregasm 2.0.0, pinned verified tarball, ~21 MB) in a worker that loads on demand; captures are read into memory, never stored or sent. See [Packet Viewer](docs/webpc/packets.md).
- **VERT ↗** opens the official [vert.sh](https://vert.sh/) converter in a new tab. It is no longer self-hosted: its 206 MB of engines would push the site past [Pages' 1 GB limit](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits). Files you convert there are handled by vert.sh, not by WebPC.
- **AI Agent** is a private on-device WebGPU assistant (Qwen3.5 0.8B/2B, LFM3 1.7B) with calculation, Wikipedia/page reading and isolated JavaScript tools, image input on the Qwen models, an opt-in cloud model (Claude or any OpenAI-compatible endpoint) using the user's own key held only in memory, feature-detected Chrome built-in AI (on-device chat plus translate/summarize/detect-language tools), file tools and search over Files grants, and `run_code` for the Linux Terminal guest with per-run approval; OCR and background-removal tools are coming. Load model explicitly downloads roughly 600 MB–1.4 GB; no model files load on opening the app. Conversation migration preserves legacy data, and Jina Reader is opt-in. See [models, storage/recovery, cancellation, source provenance and verification](docs/webpc/ai-agent.md).
- **VS Code ↗** opens the genuine `vscode.dev` service in a new tab. It is not embedded, self-hosted, or equivalent to a server-backed development environment.

The [integration research matrix](docs/webpc/app-research.md) separates installed apps from future candidates and services that need backends.
