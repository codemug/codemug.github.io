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

1. `routed = E > 1 ? (P - A) / (1 - k/E) : 0` (parameters); `r = dpa ? 1 : (mla ? g : max(1, g / kvHeads))`, the number
   of copies of the KV cache across `g` GPUs.
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
10. `minGpus`: the smallest `g` in 1, 2, 4, 8 with `g * memGb * 1e9 * memFrac >= weightsBytes + r(g) * kvFp8 * ctx + S`.
11. `sizeReplica`: the largest integer `B` in `[1, floor(bMax)]` whose `userTokS * tf >= v`. If `floor(bMax) < 1` the model is
    not offered; if even `B = 1` misses the speed, `meetsSpeed = false` and `Bv = 1`.
12. `sizeDeployment`: `replicas = ceil(C / Bv)` and `gpus = replicas * g`; `null` from `minGpus` means the model needs
    more than one 8-GPU node and is not offered.
13. API: the price tier is the one with the largest `aboveInputTokens` below `isl`, if any.
    `costPerRequest = (isl*(1-h)*input + isl*h*cachedUnit + osl*output) / 1e6` with `cachedUnit = cachedInput ?? input`.
    A request lasts `T = osl / v + ttftS`; `requestsPerHour = 3600 * C / T`;
    `usdPerMonth = requestsPerHour * costPerRequest * hoursPerDay * 30.4`.
14. Rent: `perMachine = floor(gpuCount / g)`, `machines = ceil(replicas / perMachine)`,
    `usdPerMonth = machines * (pricePerHour + addonPerHour) * hoursPerDay * 30.4`.
15. Buy: `servers = ceil(replicas / floor(server.gpuCount / g))`; amortisation, energy, rack space and support are summed
    per server, and a bought server is billed for all 24 hours.
16. Cost per million output tokens divides the monthly bill by the same `outputTokensPerMonth` on both sides.
17. `agentLoop`: `isl = c0 + (N - 1) * (d + o) / 2`, `osl = o`, `cachedShare = caching ? 1 - (d + o) / isl : 0`.
18. `sweep` sizes the deployment once per throughput factor and then takes `replicas = ceil(C / Bv)` for each `C`; the
    crossover is the first `C` where the API bill exceeds the self-hosting bill. The accuracy band repeats the sweep at
    the GPU's `band.low` and `band.high` throughput factors.

## Checking the calculation

`tests/fixtures/tokenomics/golden.json` holds cases computed by an independent Python implementation of the formulas
above. `tests/tokenomics-calc.test.mjs` requires the JavaScript functions to reproduce every case to 1e-9. To regenerate
the golden file after changing a formula:

```sh
python3 -I scripts/tokenomics/reference/calc_ref.py fixtures
node --test tests/tokenomics-calc.test.mjs
```
