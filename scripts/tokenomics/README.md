# Tokenomics calculator: data and calculation

The calculator at the end of part 6 compares what the same tokens cost on an API and on self-hosted GPUs.
Everything it shows comes from three layers:

```
scripts/tokenomics/seeds/        inputs to the build (prices, specs, measured constants), one JSON file per topic
scripts/tokenomics/build-data.mjs  reads the seeds, checks them, writes public/data/tokenomics/*.json
src/lib/tokenomics/              the calculation (step, size, cost, sweep) and, under ui/, the page logic
```

## Data build

```sh
node scripts/tokenomics/build-data.mjs     # Node 22, no dependencies
node --test tests/tokenomics-data.test.mjs
```

The build writes `models.json`, `gpus.json`, `api_prices.json`, `rent_offers.json`, `buy_options.json` and `meta.json`
into `public/data/tokenomics/` and prints a report: rows per file, rows dropped with the reason, names that did not map,
and any value that failed a check. Rules it enforces:

- Every record carries `sourceUrl` and `captured` (models carry a `sourceUrls` array). A record without them fails the build.
- Prices must be positive and inside sanity bounds: an API price is at most 1,000 USD per million tokens, a GPU machine
  price is between 0.2 and 60 USD per GPU-hour.
- Datasets whose terms bar redistribution stay out of the seeds and out of the JSON.
- No em or en dashes and no curly quotes in any output.

The page reads only these JSON files. A scheduled price change is stored on the record and shown as a note; it is never
applied before its date. `captured` is the date the page shows under the form.

## Calculation

The functions are pure and live in `src/lib/tokenomics/`. Units: bytes, seconds, tokens, USD. A month is 30.4 days.
`C` is the average number of requests in flight and may be below 1 (the page allows 0.01 to 10,000).

Definitions used below: `weightsBytes = checkpoints[bits].sizeGb * 1e9`; `F = bits[bits].peakTflops` of the GPU, which already
is the peak the GPU multiplies at at that width (for a GPU without native 4-bit math it is the 16-bit peak); `wRead` is the
value of formula 4. A scheduled price change in `api_prices.json` is shown as a note and never applied: the calculator uses
the price in force when the data was captured.

1. `r = dpa ? 1 : (mla ? g : max(1, g / kvHeads))`, the number of copies of the KV cache across `g` GPUs.
2. `bMax = (g * memGb * 1e9 * memFrac - weightsBytes) / (r * kvFp8 * reserve + S)` with `reserve = max(isl + osl, ctx)`:
   the window `ctx` is reserved in full for every request (the worst case), never the request's own length.
3. `B = max(1, min(conc, bMax))`; `touched = E > 1 ? 1 - (1 - k/E)^B : 0` (the share of routed experts a batch reads).
4. Weights read per step: `(readGbNonrouted + readGbRouted * touched) * 1e9`.
5. `kvRead = B * (r * kvFp8 * (isl + osl/2) + S)`; `tMem = (wRead + kvRead) / (g * bwTBs * 1e12 * etaBw)`.
6. `tDec = B * 2 * A / (g * F * 1e12 * etaC)` where `F` is the peak TFLOPS of the chosen bit width.
7. Prefill is charged per output token: `tPre = tDec * (isl * (1 - cachedShare)) / osl`.
8. `t0 = L * (aUs + bUs * log2(g)) * 1e-6`; step time `t = max(tMem, tDec) + tPre + t0`; with multi-token prediction
   `t = t / max(1, mtpA + mtpB * log2(B))` (off by default).
9. `userTokS = 1 / t` is the speed one stream gets; `outTokSReplica = B / t`.
10. `minGpus`: the smallest `g` in 1, 2, 4, 8 with `g * memGb * 1e9 * memFrac >= weightsBytes + r(g) * kvFp8 * ctx + S`, where `ctx`
    is the reserved window; the page always passes a `ctx` of at least `isl + osl`.
11. `sizeReplica`: the largest integer `B` in `[1, floor(bMax)]` whose `userTokS * tf >= v`, with formulas 3 to 9 evaluated at
    `conc = B` (including the multi-token-prediction division when it is on). If `floor(bMax) < 1` the model is not offered;
    if even `B = 1` misses the speed, `meetsSpeed = false` and `Bv = 1`.
12. `sizeDeployment`: `replicas = ceil(C / Bv)` and `gpus = replicas * g`, so any `C` below 1 still needs one replica;
    `null` from `minGpus` means the model needs more than one 8-GPU node and is not offered.
13. API: the price tier is the one with the largest `aboveInputTokens` below `isl`, if any.
    `costPerRequest = (isl*(1-h)*input + isl*h*cachedUnit + osl*output) / 1e6` with `cachedUnit = cachedInput ?? input`.
    A request lasts `T = osl / v + ttftS` (`ttftS` defaults to 0.5); `requestsPerHour = 3600 * C / T`;
    `usdPerMonth = requestsPerHour * costPerRequest * hoursPerDay * 30.4`;
    `outputTokensPerMonth = requestsPerHour * osl * hoursPerDay * 30.4`; `usdPerMtokOut = usdPerMonth / (outputTokensPerMonth / 1e6)`.
    The duration uses the target speed `v`, not the speed the GPUs reach, so both sides are priced for the same workload.
14. Rent: `perMachine = floor(gpuCount / g)` (the machine is not offered when `g > gpuCount`), `machines = ceil(replicas / perMachine)`,
    `usdPerMonth = machines * (pricePerHour + addonPerHour) * hoursPerDay * 30.4`, a missing `addonPerHour` counting as 0.
15. Buy (a bought server is billed for all 24 hours, so `hoursPerDay` is ignored): `servers = ceil(replicas / floor(server.gpuCount / g))`
    (not offered when `g > server.gpuCount`). Per month, with the `defaults` of `buy_options.json`:
    `amort = servers * priceUsd * (1 - residualPct/100) / (amortYears * 12)`;
    `energy = coloIncludesEnergy ? 0 : servers * powerKw * pue * hoursPerMonth * electricityUsdPerKwh`;
    `colo = servers * powerKw * coloUsdPerKwMonth`; `support = servers * priceUsd * supportPctPerYear / 100 / 12`;
    `usdPerMonth = amort + energy + colo + support`. `hoursPerMonth` is 730 there, not 24 * 30.4.
16. Cost per million output tokens divides the monthly bill by the same `outputTokensPerMonth` on both sides. A bought server is
    billed for 24 hours while the tokens follow `hoursPerDay`, which is why a part-time load raises its cost per token.
17. `agentLoop`: `isl = c0 + (N - 1) * (d + o) / 2`, `osl = o`, `cachedShare = caching ? 1 - (d + o) / isl : 0`.
18. `sweep` sizes the deployment once per throughput factor and then takes `replicas = ceil(C / Bv)` for each `C`; the
    crossover is the first `C` where the API bill exceeds the self-hosting bill. The accuracy band repeats the sweep at
    the GPU's `band.low` and `band.high` throughput factors.

## Accuracy of the speed model

The speed constants (`etaBw`, `etaC`, `aUs`, `bUs` in `gpus.json`) were fitted to 458 measured rows from SemiAnalysis
InferenceX and the AMD ROCm performance page: single node, no speculative decoding, deduplicated by `row_id`. Those rows
are only 88 distinct curves, so they are not independent. The fit was re-run for this page with the inputs the page uses
(the fit scripts and the benchmark rows are not in this repository):

- On the fit's own inputs the constants in `gpus.json` are the optimum. On the page's inputs they are within 0.1% of the
  optimum for the global record, H200 and 0.7% for MI300X and MI355X, 4.5% for H100 and 5.4% for B200, measured as the loss
  the fit minimises.
- The accuracy band is typical, not a limit. For the four GPUs calibrated at x0.7 to x1.4, 91% of rows fall inside it
  (317 of 347), and 78% when the row's model is left out of the fit. MI300X, banded x0.5 to x2, holds 90% in the fit and
  79% with the model left out. With the global constants, 96% of all rows fall inside x0.5 to x2, and 94% when the
  model, or the GPU, is left out. Misses fall on both sides (36 slower than estimated, 42 faster, model left out). The worst
  group is GLM-5 on 8 MI355X with SGLang, at 0.32 to 0.37 of the estimate.
- Known biases inside the band: B200 is under-estimated by about 4% (its bandwidth is 7.7 TB/s here, and the fit used 8),
  and the RTX PRO 6000 uses the global record and is over-estimated by about 19% on the 4 rows that exist for it.
- At the page's default (Qwen3.8 27B NVFP4, one RTX PRO 6000, a 262,144-token window, 80% cached input, 10% new input,
  10% output) one request alone reaches about 34 tokens per second. With nothing cached and 1,000 output tokens the same
  window reaches 17.3, because the whole prompt is prefilled and that charge is as large as the memory time. An
  independent implementation of formulas 1 to 9 reproduced the 17.3 case by hand and all 25 `stepModel` cases in `golden.json`.

## Checking the calculation

`tests/fixtures/tokenomics/golden.json` holds cases computed by an independent Python implementation of the formulas
above. `tests/tokenomics-calc.test.mjs` requires the JavaScript functions to reproduce every case to 1e-9. To regenerate
the golden file after changing a formula:

```sh
python3 -I scripts/tokenomics/reference/calc_ref.py fixtures
node --test tests/tokenomics-calc.test.mjs
```
