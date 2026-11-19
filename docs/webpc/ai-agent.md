# AI Agent

`/pc/apps/ai-agent/` embeds a local text agent in the WebPC desktop. The publishable authored source is `src/apps/ai-agent/`; the Astro route supplies its local asset base. `scripts/pc/prepare-ai-agent.mjs` rebuilds `public/pc/vendor/ai-agent/` from an explicit source allowlist and SHA-256-verified dependencies. No home-directory path is needed by a clean build. There is no server inference, account, Backyard SDK, speech permission, wake word, TTS, ASR or avatar.

## Runtime and data

Load model is explicit. Before that action, no model worker, WASM runtime or model weights are fetched. The app checks for WebGPU and shader-f16 support before loading. All three retained choices use immutable Hugging Face revisions in `models.js`:

| Model | Approximate first model download | Revision | License |
| --- | --- | --- | --- |
| [Qwen3.5 0.8B ONNX OPT](https://huggingface.co/onnx-community/Qwen3.5-0.8B-ONNX-OPT) | 600 MB | `9a4c21d8f724176b0a7edaaed36303044451886e` | Apache-2.0 |
| [Qwen3.5 2B ONNX OPT](https://huggingface.co/onnx-community/Qwen3.5-2B-ONNX-OPT) | 1.4 GB | `ed446636739bf426e73c5a00714fd8e010d36c21` | Base model Apache-2.0; conversion repository has no separate license metadata |
| [LFM3 1.7B ONNX](https://huggingface.co/LiquidAI/LFM3-1.7B-ONNX) | 1.4 GB | `57c125dfa29f2d39157e280b1d1f7480b8736d8d` | [LFM Open License v1.0](https://huggingface.co/LiquidAI/LFM3-1.7B-ONNX/blob/57c125dfa29f2d39157e280b1d1f7480b8736d8d/LICENSE) |

The model weights are not shipped with the website. The first load fetches from Hugging Face and its delivery hosts; completed downloads may remain in the browser cache. GPU memory needs exceed file size. Browser/device support varies; no CPU fallback or universal mobile support is claimed. These small models can answer incorrectly or miss tool calls. The LFM model has separate commercial-use conditions; consult its actual license.

The app keeps streaming, model-prefix cache reuse, timestamped user prompts, tool-call parsing, repeated-call/turn budgets and context compaction. Compaction summarizes older turns only after a nonempty summary completes, retaining recent paired tool calls/results. It does not silently drop history when summarization fails. Replies render as literal text, including Markdown/code syntax, never executable HTML. Thinking/tool markup is withheld.

Stop, changing models, New chat and cached desktop close terminate the worker, including model download, prefill and decoding. Loading again reuses completed browser cache entries. Turn identities and abort signals prevent old tool results, summaries or replies from entering a new chat. The desktop's `pcBeforeClose` hook stops inference and rejects close while a save is pending or an unexported write failed; Retry save or Export resolves that state. Page unload warns for unsaved work. Minimizing preserves the chat and allows the current request to finish.

Four tools remain:

- `calculate`: an arithmetic-only expression evaluator.
- `web_search`: keyless Wikipedia search; the query goes to Wikipedia.
- `http_get`: direct CORS fetch with omitted credentials, restricted to domains mentioned by the user or returned by search. Extracted text is bounded and treated as untrusted. Page nodes are never mounted in the live document. If direct reading fails, Jina Reader is **off by default**; enabling it explicitly sends requested URLs, including query strings, to that provider. The preference resets on page load and desktop close. There is no paywall bypass promise.
- `run_javascript`: a fresh opaque-origin `sandbox="allow-scripts"` iframe hosts a blob worker with a network-blocking CSP. Parent/worker messages are authenticated by their source window; execution has a five-second timeout and bounded output. Abort removes the iframe and its worker. No hard per-run memory ceiling is supplied.

The network tools necessarily reveal their search terms or requested URLs to the destination; this is not an entirely offline assistant. Tool data is not trusted as instructions. The app has no filesystem/other-app access.

## Save and recovery contract

The existing idb-keyval database is reused, with new keys `pc:ai-agent:conversation:v1` and `pc:ai-agent:previous:v1`. On the **same origin**, valid `voice-agent:conversation` data is copied to the new key if it is absent; the legacy record is never moved or deleted. `voice-agent:model` is read as a fallback; its key is kept. Different origins cannot read one another's local data: export JSON from the old origin and use Settings → Open backup in the new app.

Current record corruption, initial read errors and failed migration block automatic replacement. New chat/Open explicitly retain the old raw record in the previous slot and replace atomically; quota failure leaves the stored records unchanged. Writes are serialized snapshots, so a previous turn's save cannot overwrite a later New chat. The current in-memory chat remains exportable after write failure. Raw export includes current/previous/legacy records for recovery. Import validates structure and size before replacing the current conversation. There is one previous record, not a permanent version archive; export important work.

## Source migration and provenance

The original private source folder was fully inspected and backed up outside public output before editing. Its local database and configuration were preserved. Runtime modules were rewritten as a text application; obsolete avatar modules/tests and unused display fonts were removed. Private deployment instructions, `.claude` tooling, `.backyard-data`, service config, tests and the external backup are absent from generated public assets.

The original copies of Transformers.js **4.3.2** and ONNX Runtime Web **1.31.0-dev.20260914-8d85527a0** were verified byte-for-byte against their npm archives. The matching split WASM is reconstructed at byte 14,000,000. Readability **0.6.0** has a deterministic CommonJS-to-ESM footer adapter; idb-keyval **6.2.1** has an attribution comment only. No hand edits are made to minified libraries. Preparation verifies all source hashes, even on a cached build; dependency files are generated/ignored. The first clean preparation fetches roughly 28 MB. No new npm dependencies are required.

Notices, upstream declarations and license copies are in `public/third-party/ai-agent/`. The pinned ORT dev npm package has no license files and its commit URL was unavailable during verification; its standard MIT and broad third-party notices were obtained from the public v1.24.2 source tag. This is documented as a provenance limitation, not an exact inventory of that dev build's transitive native dependencies. Declared JS dependency notices are included; version labels are minimum declared ranges, not a reconstructed upstream build lockfile. Replacing ORT independently of Transformers is not recommended without rerunning real inference.

## Verification

`tests/pc-ai-agent-logic.test.mjs` and `tests/pc-ai-agent-lifecycle.test.mjs` cover real arithmetic/tool parsing, Markdown preservation, late-reply/tool/summary isolation, worker cancellation, migration, ordering, quota, corrupt records and read-failure recovery. `tests/browser/pc-ai-agent.spec.mjs` uses a deterministic **model worker only** to test real UI, IndexedDB, tools, sandbox, proxy behavior, cancellation, close guards and mobile sizing. It does not claim to test model quality.

An additional manual Chromium smoke on an AMD RDNA 3 WebGPU adapter loaded the actual pinned Qwen3.5 0.8B model, generated a reply, cancelled a long prompt, then reloaded the model and generated again. Normal unflagged headless Chromium had no adapter and showed the supported unavailable state. The tested launch used `--enable-unsafe-webgpu --enable-features=Vulkan --use-angle=vulkan`; these are local test flags, not a requirement automatically imposed on visitors. The two larger model choices were retained with pinned metadata but were not downloaded for this smoke. Full cross-browser/GPU validation and model-quality evaluation are not claimed.
