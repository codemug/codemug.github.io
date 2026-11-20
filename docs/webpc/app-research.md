# WebPC integration research

Checked 2026-11-18 against the projects' primary documentation. These are integration recommendations, not a claim that every candidate is installed. The registry is the installed-app source of truth. WebPC remains a static Astro/GitHub Pages site; native host processes and arbitrary remote database connections need backend services; the Linux VM supplies emulated guest processes locally.

| Requested tool | Static-site fit and recommendation | Primary source / license |
| --- | --- | --- |
| CyberChef | Actual released web artifact can be served locally. Pin v11.5.0 and checksum its 83 MB ZIP; load only on launch. Keep original bundle and licenses, with a thin wrapper for desktop readiness. Operations that deliberately fetch URLs still use the network. | [CyberChef](https://github.com/gchq/CyberChef), [v11.5.0 release](https://github.com/gchq/CyberChef/releases/tag/v11.5.0); Apache-2.0 |
| VS Code | `vscode.dev` is an actual browser VS Code service; an explicit external link is honest. Self-hosted OpenVSCode Server or code-server requires a running backend. Monaco is an editor component, not full VS Code; if integrated it must be named Code Editor and explain missing terminals/extensions. | [VS Code for the Web](https://code.visualstudio.com/docs/remote/vscode-web), [OpenVSCode Server](https://github.com/gitpod-io/openvscode-server), [code-server](https://github.com/coder/code-server) |
| Terminal | Installed: v86 boots a real 32-bit Alpine Linux kernel and shell locally; xterm.js renders its serial console. No guest network relay is configured. Native host shell/SSH instead needs an authenticated service such as ttyd. | [v86](https://github.com/copy/v86), [Linux integration notes](linux-terminal.md), [xterm.js](https://xtermjs.org/), [ttyd](https://github.com/tsl0922/ttyd) |

## Curated next candidates

- [IT-Tools](https://github.com/CorentinTh/it-tools): coherent local developer utilities, useful for UUIDs, text conversions, and format inspection. Review its built asset paths and bundled fonts before adding; avoid duplicating CyberChef's many transformations.
- [Excalidraw](https://github.com/excalidraw/excalidraw): local sketching/diagram component and exports; real-time collaboration needs additional services. Prefer the library with explicit local persistence over implying the entire hosted service is included.
- [Mermaid Live Editor](https://github.com/mermaid-js/mermaid-live-editor): text-to-diagram workbench; disable or explicitly disclose optional external rendering/sharing integrations in a local deployment.

No placeholder launchers are added for unimplemented candidates. Backend services need explicit deployment, access control, connection configuration, and operational ownership before WebPC can open them as working apps.

Additional primary-source candidates reviewed by the lead:
- [Squoosh](https://github.com/GoogleChromeLabs/squoosh): browser-local image compression. Review and remove upstream analytics before a privacy-oriented self-hosted build.
- [DuckDB-Wasm](https://github.com/duckdb/duckdb-wasm): MIT browser analytics engine for CSV, JSON, and Parquet; a stronger future data-workbench option, still not arbitrary remote database access.

## Current implementation decision

Implemented scope: pinned CyberChef release, v86-powered Alpine Linux Terminal, and external `vscode.dev` launcher. Docs/Slides are integrated separately by the office-app owner. CloudBeaver, code-server, Hoppscotch, and the shortlist above remain research only unless explicitly present in the registry.

## 2026-11-20 status

Candidates that made it onto the desktop on this branch (the registry remains the installed-app source of truth):

- **Excalidraw 0.18.1** — the curated candidate, implemented as recommended: the library bundled locally with explicit local persistence and no hosted-service or collaboration backends. [Excalidraw in WebPC](excalidraw.md).
- **GridCraft 0.19.1 / DeckCraft 0.18.1** — pinned official Storytold releases; they take over the removed Sheets/Slides apps (CasualOffice Docs stays as its own app, outside the Craft pipeline). [Craft integration notes](craft-apps.md).
- **FilmCraft 0.20.1, CADCraft 0.20.1, VectorCraft 0.24.1, PhotoCraft 0.23.1, EffectCraft 0.24.1, MaterialCraft 0.4.1, TextureCraft 0.6.1** — pinned official releases; the last five (plus SoundCraft) run in standalone mode because their web builds ship no host bridge. [Craft integration notes](craft-apps.md).
- **SQLiteViz 0.32.1, BeepBox 4.2.2** — pinned releases integrated unmodified. [Static web apps](static-apps.md).
- **Files, Media Player** — WebPC-native apps over the browser's own OPFS and `<video>` element; no external assets, and Files is the cross-app open/save bridge. [Files](files.md), [Media Player](media.md).
- **Network Tools** — WebPC-native tools (pinned npm dependencies, esbuild-bundled): local subnet/latency plus DoH, RDAP/crt.sh/Shodan and keyless Globalping lookups, and local zxcvbn/age. [Network and Security Tools](nettools.md).
- **Packet Viewer** — Wireshark 4.6 dissection via wiregasm 2.0.0 (pinned verified tarball, ~21 MB WASM engine on demand), fully local. [Packet Viewer](packets.md).
- **AI Agent** — image input on the Qwen models, opt-in user-keyed cloud model, feature-detected Chrome built-in AI, Files grant tools and `search_files`, and `run_code` into the Linux guest. [AI Agent](ai-agent.md).

Still research only (not in the registry):

- **draw.io** — real-time collaboration and document sharing need backend services, and no pinned static release was chosen for integration.
- **JupyterLite** — kernel packages are large and are normally fetched from remote CDNs at runtime, which conflicts with the pinned-local-asset rule.
- **Kiwix** — the reader is static, but content is separately supplied ZIM archives; no content choice has been made.
- **IT-Tools** — its built asset paths and bundled fonts still need review, and many of its transformations duplicate CyberChef's.
- **Squoosh** — upstream analytics must be reviewed and removed before a privacy-oriented self-hosted build.
- **DuckDB-Wasm** — a stronger future data-workbench option; still not arbitrary remote-database access.
- **Mermaid Live Editor** — still not integrated; its optional external rendering/sharing integrations would need to be disabled or explicitly disclosed in a local deployment.
- **Nodecast TV** — research only with its own doc; hosting choice pending, since GitHub Pages cannot run its Node/FFmpeg backend. [Nodecast TV](nodecast-tv.md)
