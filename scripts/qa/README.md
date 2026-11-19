# Illustration checks

Install from this repository; no sibling workspace or hard-coded browser path is needed:

```sh
npm ci
npx playwright install --with-deps chromium
npm test
npm run build
npm run test:browser
```

The browser suite owns a preview server on port 4325 and closes it on completion or
failure. Do not rebuild `dist/` during a run. Traces from failures are retained in
the system temporary directory under `codemug-playwright-results/<timestamp>-<pid>/`.
Each runner gets its own directory; worker processes inherit that run ID, so
another invocation cannot erase an active run's traces. Failure output prints
the exact trace path. Runs still share port 4325: run one preview-backed suite
at a time, and do not stop another runner's server.

Regressions check actual SVG drawing state after rewind and interrupted chained
animations, reduced-motion 3D output, repeated theme changes, native keyboard
activation, offscreen timers, changing motion preferences, all included deck
states, mobile expansion, site colors, and the hero canvas lifecycle.

The small `tests/fixtures/deck-source.html` contains representative original
source fragments and shared CSS. It is extractor input, not a runnable deck. The
extraction tests always run without the original talk. If local `deck.html` exists,
an additional integration test compares all generated slides and metadata. Full
regeneration still requires the external original:

```sh
node scripts/extract-deck.mjs /path/to/original/deck.html
```

Maintain generated-slide adaptations in the extractor; shared animation ownership
belongs in `deck-runtime.js`. The compact fixture must retain old source fragments
so a regression cannot be hidden by supplying already-fixed input.

For manual diagnostics against a separately running preview:

```sh
node scripts/qa/deck-check.mjs http://localhost:4321/blog/sre-guide-deploying-llms-part-1/ --reduced
node scripts/qa/deck-check.mjs http://localhost:4321/blog/sre-guide-deploying-llms-part-2/ --only=p2-fewer-bits --min-contrast=4.5
node scripts/qa/fp-shots.mjs http://localhost:4321/blog/gaming-pc-agent-platform/ /tmp/primer-frames
```

`deck-check` retains its **2:1 gross contrast smoke threshold** by default. This is
not WCAG conformance: it compares text with the figure background, which may differ
from a filled SVG shape behind that text, and ignores faded/knockout labels. The
configurable threshold is a stricter diagnostic, not a substitute for checking
actual backgrounds, effective font sizes, and accessibility. Zero iframe figures
are reported as skipped interaction/theme checks, not as tested board behavior.

The optional `public/llm-illustrations.html` is explicitly labeled a historical
prototype; maintained article figures are the source of truth. Its legacy controls
receive the same keyboard, visibility, and motion fixes.

The untracked `devto-images-primer/06-workspace.png` has overlapping task-card and
caption text. Its original export source is absent: the maintained `Fig.astro`
uses a different layout. The bitmap and archive were preserved, rather than
inventing a source or silently replacing the author's design. Use `fp-shots` to
produce a fresh, reviewable export from the maintained figure when updating that
crosspost; archive packaging is not part of the build.
