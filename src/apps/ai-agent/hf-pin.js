// Hugging Face revision pinning by URL — shared by all model workers (worker.js, embed-worker.js,
// vision-worker.js). The vendored Transformers.js 4.3.2 drops the `revision` option for some file
// fetches (the tokenizer_config.json probe on from_pretrained; the pipeline() file-map pre-fetch —
// which on Xenova/modnet even pulled onnx/model.onnx at main) and offers no custom-fetch hook: it
// captures globalThis.fetch at module scope (`fetch: GP`). The only reliable pinning point is the
// fetch itself. Each worker imports this module FIRST (ESM evaluates it before the bundle's module
// scope), so its side effect — patching globalThis.fetch — lands in time. For every repo in
// HF_PINNED (the single source of truth for the pinned revisions), `/resolve/main/` and the
// resolve-cache API form are rewritten to the pinned revision; every other URL passes untouched.
export const HF_PINNED = {
  'onnx-community/Florence-2-base-ft': 'e88a44eaf3791a35eae0c5a47b3dbcd36e67eb6f',
  'Xenova/modnet': 'fa2fa546052fba4c08921230a26cc69a333fca12',
  'onnx-community/BiRefNet_lite-ONNX': 'de15b22ba131738a16dff04aab8bdf8dc32e3ac1',
  'Xenova/all-MiniLM-L6-v2': '751bff37182d3f1213fa05d7196b954e230abad9',
  'onnx-community/Qwen3.5-0.8B-ONNX-OPT': '9a4c21d8f724176b0a7edaaed36303044451886e',
  'onnx-community/Qwen3.5-2B-ONNX-OPT': 'ed446636739bf426e73c5a00714fd8e010d36c21',
  'LiquidAI/LFM3-1.7B-ONNX': '57c125dfa29f2d39157e280b1d1f7480b8736d8d',
};
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const REWRITES = Object.entries(HF_PINNED).flatMap(([repo, sha]) => [
  [new RegExp(`^https://huggingface\\.co/${esc(repo)}/resolve/main/`), `https://huggingface.co/${repo}/resolve/${sha}/`],
  [new RegExp(`^https://huggingface\\.co/api/resolve-cache/models/${esc(repo)}/main/`), `https://huggingface.co/api/resolve-cache/models/${repo}/${sha}/`],
]);
/** Rewrite a `/resolve/main/` (or resolve-cache API) URL of a pinned repo to the pinned revision; pass everything else through. */
export function pinnedUrl(url) {
  if (typeof url !== 'string') return url;
  for (const [re, to] of REWRITES) if (re.test(url)) return url.replace(re, to);
  return url;
}
// Side effect on import: patch fetch BEFORE the bundle's module scope captures it. globalThis
// (not self) so the module also imports cleanly in node tests.
if (!globalThis.__hfPinned) {
  globalThis.__hfPinned = true;
  const real = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (input, init) => real(typeof input === 'string' ? pinnedUrl(input) : input, init);
}
