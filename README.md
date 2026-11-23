# Usman Shahid's site

Static portfolio and technical blog at **https://usmanshahid.is-a.dev**. Built with Astro 6, MDX, Tailwind CSS 4, self-hosted Inter/JetBrains Mono, and native browser scripts. GitHub Pages serves the build; Giscus stores comments in GitHub Discussions.

## Development and checks

Use Node.js **22.12 or newer** and the committed npm lockfile.

```sh
npm ci --ignore-scripts
npm run dev                # http://localhost:4321; includes draft posts
npm test                   # source/runtime regression tests
npm run build              # production output in dist/; excludes drafts
npm run webpc              # add the latest WebPC build to dist/ (after npm run build)
npm run preview            # inspect the production build locally
```

Browser checks require Chromium; see the illustration workflow below. The Pages workflow in [.github/workflows/deploy.yml](.github/workflows/deploy.yml) installs locked dependencies, runs unit tests, builds, adds the latest WebPC build, and deploys `dist/` on pushes to `main`, once a day, and on manual dispatch. The Chromium browser checks run locally. `astro build` is not a full TypeScript check.

## Routes and source of truth

- `/`: portfolio, experience, Primer, local posts and selected external writing; data lives in `src/pages/index.astro`.
- `/blog/` and `/blog/<slug>/`: articles from `src/content/blog/*.{md,mdx}`. The filename supplies the slug. Published articles currently include Primer and all six parts of the SRE LLM-deployment series.
- `/pc/`: the WebPC desktop, built and tested in [codemug/webpc](https://github.com/codemug/webpc). `npm run webpc` downloads its latest build (verified by SHA-256) into `dist/pc/` and `dist/third-party/`; this repo has no WebPC code.
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

## WebPC

WebPC, the browser desktop at `/pc/`, is its own project: [codemug/webpc](https://github.com/codemug/webpc). There, a YAML catalog pins every app, a weekly workflow upgrades them after tests and smoke checks, and every tested push to its main updates a draft of the next version. This site's deploy downloads the published version pinned in `webpc.version` after `astro build`; to upgrade WebPC, publish the draft there and bump that file in a pull request. The navigation link lives in `src/layouts/Base.astro`.

## Contact

- [Email](mailto:u.manshahid@gmail.com)
- [LinkedIn](https://linkedin.com/in/u-manshahid)
- [Medium](https://medium.com/@usmanshahid)
