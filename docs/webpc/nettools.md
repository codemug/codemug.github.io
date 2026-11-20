# Network and Security Tools in WebPC

`nettools` — "Network and Security Tools" — at `/pc/apps/nettools/`. Five tabs: Subnet (local), DNS over HTTPS, Domain & IP (RDAP / crt.sh / Shodan InternetDB), Global Ping (Globalping, keyless), Latency, and Security (zxcvbn password strength + age file encryption, both fully local). Bundled like Excalidraw/Docs: `scripts/pc/nettools/*.mjs` source, `scripts/pc/prepare-nettools.mjs` preparer, output in `public/pc/vendor/nettools/`.

## Prepare and update

Run `node scripts/pc/prepare-nettools.mjs` (wired into `assets:pc` after the other preparers). Four devDependencies are pinned exactly in `package.json` (`--save-exact --ignore-scripts`) with lockfile integrity, and the preparer re-verifies each against `package-lock.json` before skipping a rebuild:

| Package | Version | Licence | Used by |
|---|---|---|---|
| `@zxcvbn-ts/core` | 4.3.0 | MIT (no licence file ships in the package; attribution generated) | Security tab |
| `@zxcvbn-ts/language-common` | 4.2.0 | MIT (NOTICE.md: ODC-BY subtitle data) | Security tab |
| `@zxcvbn-ts/language-en` | 4.1.2 | MIT (NOTICE.md: ODC-BY subtitle data) | Security tab |
| `age-encryption` | 0.3.1 | BSD-3-Clause (pure-JS, noble crypto deps) | Security tab |

The preparer esbuild-bundles `scripts/pc/nettools/main.mjs` (production, minified, ESM, `splitting: true`) so each tab is its own lazy chunk — the Security tab's chunk carries the ~1.7 MB zxcvbn dictionaries + age and loads only on first visit. It copies `nettools.css`, writes a CSP-locked `index.html` and a `.release.json` fingerprint (preparer source + every `scripts/pc/nettools/*.{mjs,css}` file + the pinned versions). `public/third-party/nettools/` holds `WEBPC.txt`, per-package licence files (copied, or generated from the installed `package.json` when a package ships none), and `BUNDLED-NOTICES.txt` (full licence texts of every bundled package, via `writeBundleNotices`).

## Tabs and services

- **Subnet** — fully local CIDR math for IPv4/IPv6: network, broadcast (v4), first/last host (RFC 3021: /31 and /32 have no network/broadcast address), mask, prefix, address count (BigInt for v6).
- **DNS** — DNS over HTTPS via Cloudflare (default) or Google (`accept: application/dns-json`); types A, AAAA, CNAME, MX, TXT, NS, SOA, CAA, PTR. PTR builds the reverse name from a validated IP.
- **Domain & IP** — RDAP via `rdap.org` (`/domain/<d>` or `/ip/<ip>`; summarises registrar, dates, status, nameservers), crt.sh certificate transparency (names deduped, capped at 200, warned slow/flaky), Shodan InternetDB (OS, CPE, hostnames, ports, CVEs).
- **Global Ping** — Globalping keyless API: `POST /v1/measurements` with `{type, target, locations:[{magic}], limit}`, then polls `GET /v1/measurements/<id>` no faster than every 500 ms until top-level `status: "finished"` (cap 60 s). The response shape (verified against the live API) keys `results` by probe index, each entry `{probe: {city, country, network,…}, result: {status, rawOutput, resolvedAddress, resolvedHostname, timings?|hops?|answers?|status_code?|times?}}`; the structured fields are rendered and `rawOutput` (the CLI dump) is dropped.
- **Latency** — N (1–10) timed fetches to a user https URL with `mode: 'no-cors'` (+ `cache: 'no-store'`), reporting min/avg/max, explicitly labelled "HTTP round-trip, not ICMP ping".
- **Security** — password strength via `ZxcvbnFactory` (score 0–4, localised crack-time displays, warning/suggestions) and age passphrase encrypt/decrypt of a chosen file (scrypt work factor 18) with a Blob-URL download of the result. Both run fully in the browser.

## What WebPC enforces

- **Click-only network**: nothing is fetched on page load or tab switch; every external call happens on an explicit button click. Verified by the headless check (zero non-localhost requests on load).
- **Named services**: every button and result names the receiving service ("Look up via Cloudflare DNS-over-HTTPS", "Measure via <host>", "Run via Globalping", …).
- **Fetch policy**: every external `fetch` uses `credentials: 'omit'`, `referrerPolicy: 'no-referrer'`, `AbortSignal.timeout(15000)`; errors render in a visible error line.
- **Text-only rendering**: external data goes through `textContent` (the UI is built with `el()`; no `innerHTML` of any response anywhere).
- **Input validation first**: domain/hostname syntax, strict IPv4 (no leading zeros) / IPv6, https-only URLs, PTR from a valid IP, Globalping type/limit (1–5) — all before any request.
- **CSP** (vendor `index.html`): `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' https:; img-src 'self' data:; object-src 'none'`. `connect-src` is intentionally broad because RDAP redirects to many registry hosts (e.g. `rdap.verisign.com`) and the DoH/Globalping services live on separate hosts; the trade-off is safe only because every such fetch is a user click, names its service, and renders text-only.
- **Theme**: the vendor page reads `nettools:theme` from `localStorage` and follows `pc:theme` messages from the same-origin wrapper; the wrapper (`src/scripts/pc/apps/nettools.mjs`) forwards its own theme and polls `window.webpcNettools` for readiness. `pcBeforeClose` is a no-op: the app persists nothing.

## Storage (BRIEF rule 6)

No `localStorage.clear`/`sessionStorage.clear`, no `indexedDB.deleteDatabase`, no `navigator.storage.getDirectory`. The only keys this app touches are `nettools:theme` (light/dark, set by the theme listener) and the desktop's own `theme` (read by the wrapper layout). The password field's value and any chosen file live only in the DOM/memory for the lifetime of the page — never written to storage, never logged, never sent. **No origin-wide wipe; no scoping needed.**

## Network (BRIEF rule 5)

The only outbound endpoints, all user-click-initiated: `cloudflare-dns.com` / `dns.google` (DoH), `rdap.org` (+ the registry host it redirects to), `crt.sh`, `internetdb.shodan.io`, `api.globalping.io`, and the user-supplied https URL for the Latency tab. Globalping probes see the target and the user's IP (free tier 250 tests/hour) — stated on the app page and in the tab help. **Verified by the headless check** (a Playwright script against the dev server, not committed): zero non-localhost requests on load (light and dark), and the only real calls during the whole run were exactly one Cloudflare DNS A for `example.com`, one RDAP lookup for `example.com` (redirect counted), and one Globalping ping to `example.com` with `limit: 1` (2 poll GETs, bounded, no loops) — with no crt.sh / Shodan / Google DoH traffic.

## Validation

`node --test tests/pc-nettools.test.mjs` — 16 tests for the pure helpers: subnet math (v4 `/24` → 256, v4 `/31` → 2, v6 `/64` → 2^64 BigInt, bad-input rejection), input validators (domain/IPv4/IPv6/URL, including leading-zero octets, `:::` garbage, embedded-v4 tails, https-only), the PTR builder (v4 + v6, v6 cross-checked against an independent hex-reverse computation), DNS answer formatting (A/TXT/MX/NS/CAA/SOA/empty), the RDAP/crt.sh/InternetDB summarisers (including both real-world vCard-JSON shapes), the Globalping request builder (defaults, custom values, rejections), the Globalping formatter (verified live-API shape), and the latency summariser. Headless check: see the Network section above. **Status: run — all checks pass; light and dark screenshots reviewed.**
