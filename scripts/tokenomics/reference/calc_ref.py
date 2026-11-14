"""Reference implementation of the tokenomics calculator (the formulas in scripts/tokenomics/README.md).
Independent of the JavaScript port: tests/tokenomics-calc.test.mjs compares src/lib/tokenomics/calc.mjs to the golden
file this script writes.

Usage:  python3 -I scripts/tokenomics/reference/calc_ref.py fixtures
            writes tests/fixtures/tokenomics/fixtures.json and golden.json from the seeds
        python3 -I scripts/tokenomics/reference/calc_ref.py check DIR
            prints a few cases from the built JSON files in DIR
"""
import json
import math
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
SEEDS = HERE.parent / "seeds"
OUT = HERE.parents[2] / "tests" / "fixtures" / "tokenomics"
DAYS = 30.4


def step_model(model, bits, gpu, g, isl, osl, conc, mtp=False, cached_share=0.0, dpa=None, ctx=None):
    c = gpu["constants"]
    dpa = model["dpa"] if dpa is None else dpa
    ck = model["checkpoints"][str(bits)]
    E, k = model["E"], model["k"]
    r = 1 if dpa else (g if model["mla"] else max(1.0, g / model["kvHeads"]))
    weights = ck["sizeGb"] * 1e9
    # capacity reserves the whole context window for every request (worst case), never the request's own length
    reserve = max(isl + osl, ctx or 0)
    b_max = (g * gpu["memGb"] * 1e9 * c["memFrac"] - weights) / (r * model["kvFp8"] * reserve + model["S"])
    B = max(1.0, min(conc, b_max))
    touched = 1 - (1 - k / E) ** B if E > 1 else 0.0
    w_read = (ck["readGbNonrouted"] + ck["readGbRouted"] * touched) * 1e9
    kv_read = B * (r * model["kvFp8"] * (isl + osl / 2) + model["S"])
    t_mem = (w_read + kv_read) / (g * gpu["bwTBs"] * 1e12 * c["etaBw"])
    F = gpu["bits"][str(bits)]["peakTflops"]
    t_dec = B * 2 * model["A"] / (g * F * 1e12 * c["etaC"])
    t_pre = t_dec * (isl * (1 - cached_share)) / osl
    t0 = model["L"] * (c["aUs"] + c["bUs"] * math.log2(g)) * 1e-6
    t = max(t_mem, t_dec) + t_pre + t0
    if mtp:
        t /= max(1.0, c["mtpA"] + c["mtpB"] * math.log2(B))
    return {"B": B, "bMax": b_max, "queued": max(0.0, conc - B), "tMemMs": t_mem * 1e3, "tDecMs": t_dec * 1e3,
            "tPreMs": t_pre * 1e3, "t0Ms": t0 * 1e3, "tpotMs": t * 1e3, "userTokS": 1 / t,
            "outTokSPerGpu": B / (t * g), "outTokSReplica": B / t}


def min_gpus(model, bits, gpu, ctx, dpa=None):
    c = gpu["constants"]
    dpa = model["dpa"] if dpa is None else dpa
    weights = model["checkpoints"][str(bits)]["sizeGb"] * 1e9
    for g in (1, 2, 4, 8):
        r = 1 if dpa else (g if model["mla"] else max(1.0, g / model["kvHeads"]))
        if g * gpu["memGb"] * 1e9 * c["memFrac"] >= weights + r * model["kvFp8"] * ctx + model["S"]:
            return g
    return None


def size_replica(model, bits, gpu, g, isl, osl, v, mtp=False, cached_share=0.0, tf=1.0, ctx=None):
    st = step_model(model, bits, gpu, g, isl, osl, 1, mtp, cached_share, ctx=ctx)
    hi = math.floor(st["bMax"])
    if hi < 1:
        return {"Bv": 0, "meetsSpeed": False}

    def ok(B):
        return step_model(model, bits, gpu, g, isl, osl, B, mtp, cached_share, ctx=ctx)["userTokS"] * tf >= v

    if not ok(1):
        return {"Bv": 1, "meetsSpeed": False}
    lo = 1
    while lo < hi:
        mid = (lo + hi + 1) // 2
        if ok(mid):
            lo = mid
        else:
            hi = mid - 1
    return {"Bv": lo, "meetsSpeed": True}


def size_deployment(inp):
    model, bits, gpu = inp["model"], inp["bits"], inp["gpu"]
    g = min_gpus(model, bits, gpu, inp["ctx"])
    if g is None:
        return {"offered": False, "reason": "needs more than one 8-GPU node"}
    rep = size_replica(model, bits, gpu, g, inp["isl"], inp["osl"], inp["v"], inp.get("mtp", False),
                       inp.get("cachedShare", 0.0), inp.get("tf", 1.0), ctx=inp["ctx"])
    if rep["Bv"] < 1:
        return {"offered": False, "reason": "one request does not fit in memory at this context"}
    replicas = math.ceil(inp["C"] / rep["Bv"])
    return {"offered": True, "g": g, "replicas": replicas, "gpus": replicas * g, "Bv": rep["Bv"],
            "meetsSpeed": rep["meetsSpeed"], "confidence": gpu["confidence"]}


def api_cost_per_request(price, isl, osl, cached_share):
    p_in, p_cache, p_out = price["input"], price["cachedInput"], price["output"]
    best = None
    for t in price.get("tiers") or []:
        if isl > t["aboveInputTokens"] and (best is None or t["aboveInputTokens"] > best["aboveInputTokens"]):
            best = t
    if best:
        p_in, p_cache, p_out = best["input"], best["cachedInput"], best["output"]
    cached_unit = p_in if p_cache is None else p_cache
    return (isl * (1 - cached_share) * p_in + isl * cached_share * cached_unit + osl * p_out) / 1e6


def api_monthly(price, C, isl, osl, cached_share, v, ttft_s, hours_per_day):
    T = osl / v + ttft_s
    rph = 3600 * C / T
    cost = rph * api_cost_per_request(price, isl, osl, cached_share) * hours_per_day * DAYS
    tokens = rph * osl * hours_per_day * DAYS
    return {"requestsPerHour": rph, "usdPerMonth": cost, "outputTokensPerMonth": tokens,
            "usdPerMtokOut": cost / (tokens / 1e6)}


def rent_monthly(dep, offer, hours_per_day, tokens_per_month=None):
    if dep["g"] > offer["gpuCount"]:
        return {"offered": False, "reason": "replica needs more GPUs than the machine has"}
    per_machine = offer["gpuCount"] // dep["g"]
    machines = math.ceil(dep["replicas"] / per_machine)
    per_hour = machines * (offer["pricePerHour"] + (offer.get("addonPerHour") or 0))
    month = per_hour * hours_per_day * DAYS
    out = {"offered": True, "machines": machines, "usdPerHour": per_hour, "usdPerMonth": month}
    if tokens_per_month:
        out["usdPerMtokOut"] = month / (tokens_per_month / 1e6)
    return out


def buy_monthly(dep, server, d, tokens_per_month=None):
    if dep["g"] > server["gpuCount"]:
        return {"offered": False, "reason": "replica needs more GPUs than the server has"}
    servers = math.ceil(dep["replicas"] / (server["gpuCount"] // dep["g"]))
    amort = servers * server["priceUsd"] * (1 - d["residualPct"] / 100) / (d["amortYears"] * 12)
    energy = 0 if d["coloIncludesEnergy"] else servers * server["powerKw"] * d["pue"] * d["hoursPerMonth"] * d["electricityUsdPerKwh"]
    colo = servers * server["powerKw"] * d["coloUsdPerKwMonth"]
    support = servers * server["priceUsd"] * d["supportPctPerYear"] / 100 / 12
    total = amort + energy + colo + support
    out = {"offered": True, "servers": servers, "usdPerMonth": total,
           "parts": {"amort": amort, "energy": energy, "colo": colo, "support": support}}
    if tokens_per_month:
        out["usdPerMtokOut"] = total / (tokens_per_month / 1e6)
    return out


def agent_loop(c0, d, o, N, caching):
    isl = c0 + (N - 1) * (d + o) / 2
    share = 0.0
    if caching and N > 1:
        share = min(1.0, max(0.0, 1 - (d + o) / isl))
    return {"isl": isl, "osl": o, "cachedShare": share}


def sweep(inp, cs, price, cost_fn):
    """cost_fn(dep, tokens_per_month) -> usdPerMonth or None. Returns lists aligned with cs."""
    gpu = inp["gpu"]
    out = {"api": [], "selfMid": [], "selfLow": [], "selfHigh": [], "replicasMid": []}
    reps = {}
    for key, tf in (("selfMid", 1.0), ("selfLow", gpu["band"]["high"]), ("selfHigh", gpu["band"]["low"])):
        reps[key] = size_deployment({**inp, "C": 1, "tf": tf})
    for C in cs:
        a = api_monthly(price, C, inp["isl"], inp["osl"], inp.get("cachedShare", 0.0), inp["v"], inp["ttftS"], inp["hoursPerDay"])
        out["api"].append(a["usdPerMonth"])
        for key in ("selfMid", "selfLow", "selfHigh"):
            r = reps[key]
            if not r["offered"]:
                out[key].append(None)
                continue
            dep = {**r, "replicas": math.ceil(C / r["Bv"])}
            dep["gpus"] = dep["replicas"] * dep["g"]
            out[key].append(cost_fn(dep, a["outputTokensPerMonth"]))
            if key == "selfMid":
                out["replicasMid"].append(dep["replicas"])
    return out


def crossover(sw, cs):
    def first(key):
        for C, a, s in zip(cs, sw["api"], sw[key]):
            if s is not None and a > s:
                return C
        return None
    return {"low": first("selfLow"), "mid": first("selfMid"), "high": first("selfHigh")}


# ---------------------------------------------------------------- fixtures from the seeds
def load(name):
    return json.load(open(SEEDS / name))


def fixture_models():
    out = []
    for x in load("models_focus.json"):
        mi = x["m1_inputs"]
        cks = {}
        for b, v in x["checkpoints_by_bits"].items():
            cks[b] = {"repo": v.get("repo"), "format": v.get("format"), "sizeGb": v["size_gb"],
                      "bitsPerWeight": v.get("bits_per_weight_all"), "readGbNonrouted": v["nonrouted_read_gb"],
                      "readGbRouted": v["routed_gb"], "estimated": v.get("repo") is None, "note": v.get("kind")}
        mla = mi["h_kv"] == "mla"
        out.append({"id": x["id"], "name": x["name"], "P": mi["P"], "A": mi["A"], "E": mi["E"], "k": mi["k"],
                    "L": mi["L"], "kvFp8": mi["kv_fp8"], "kvBf16": x["kv_bytes_per_token"]["bf16"], "S": mi["S"],
                    "kvHeads": 1 if mla else mi["h_kv"], "mla": mla, "dpa": mi["dpa"], "contextMax": x["context_max"],
                    "checkpoints": cks})
    return out


GPU_MAP = {"rtx6000pro": "RTX PRO 6000 Blackwell Server Edition", "l40s": "L40S", "h100": "H100 SXM",
           "h200": "H200 SXM", "b200": "B200 (HGX)", "b300": "B300 (HGX)", "gb200": "GB200 (NVL72, per GPU)",
           "mi300x": "MI300X", "mi355x": "MI355X"}


def fixture_gpus():
    prec = {p["gpu"]: p for p in load("gpu_precision.json")}
    specs = {s["gpu"]: s for s in load("gpus.json")}
    cons = {c["gpu"]: c for c in load("constants.json") if c["scope"] == "per_gpu"}
    glob = [c for c in load("constants.json") if c["scope"] == "global"][0]
    ov = {}
    for r in load("gpu_overrides.json"):
        ov.setdefault(r["gpu"], {})[r["field"]] = r["value"]
    out = []
    for gid, name in GPU_MAP.items():
        p = prec[name]
        spec = specs[name]
        o = ov.get(name, {})
        cid = {"gb200": "b200", "b300": "b200"}.get(gid, gid)
        # M1: RTX PRO 6000 (4 fit rows) and L40S (none) use the global constants
        c = glob if gid in ("rtx6000pro", "l40s") else cons.get(cid, glob)
        cal = gid in ("h100", "h200", "b200", "mi300x", "mi355x")
        def peak(v):
            return o.get(v["peak_key"] + "_dense_tflops", v["peak_tflops"])
        out.append({"id": gid, "name": name, "memGb": o.get("memory_gb", spec["memory_gb"] or p.get("memory_gb")),
                    "bwTBs": o.get("bandwidth_tbps", spec["bandwidth_tbps"]),
                    "bits": {b: {"mode": v["mode"], "peakTflops": peak(v)} for b, v in p["bit_widths"].items()},
                    "constants": {"etaBw": c["eta_bw"], "etaC": c["eta_c"], "aUs": c["overhead_a_us_per_layer"],
                                  "bUs": c["overhead_b_us_per_layer_per_log2g"], "memFrac": 0.9, "mtpA": 1.721, "mtpB": -0.0907},
                    "confidence": "calibrated" if cal else "extrapolated",
                    # MI300X in-sample p90 error is 65 percent (M1), beyond the +-40 percent of the standard band
                    "band": {"low": 0.7, "high": 1.4} if (cal and gid != "mi300x") else {"low": 0.5, "high": 2.0}})
    return out


BUY_DEFAULTS = {"amortYears": 5, "residualPct": 0, "pue": 1.3, "electricityUsdPerKwh": 0.14,
                "coloUsdPerKwMonth": 200, "coloIncludesEnergy": False, "supportPctPerYear": 5, "hoursPerMonth": 730}


def make_fixtures():
    models = fixture_models()
    gpus = fixture_gpus()
    prices = {
        "plain": {"id": "x:plain", "input": 2.0, "cachedInput": 0.2, "output": 10.0, "tiers": []},
        "tiered": {"id": "x:tiered", "input": 10.0, "cachedInput": 1.0, "output": 50.0,
                   "tiers": [{"aboveInputTokens": 272000, "input": 20.0, "cachedInput": 2.0, "output": 75.0}]},
        "nocache": {"id": "x:nocache", "input": 1.0, "cachedInput": None, "output": 4.0, "tiers": []},
    }
    offers = {"b200x8": {"id": "x:b200x8", "gpu": "b200", "gpuCount": 8, "pricePerHour": 60.0, "addonPerHour": None},
              "h100x4": {"id": "x:h100x4", "gpu": "h100", "gpuCount": 4, "pricePerHour": 16.0, "addonPerHour": 0.5},
              "rtx1": {"id": "x:rtx1", "gpu": "rtx6000pro", "gpuCount": 1, "pricePerHour": 3.0, "addonPerHour": None}}
    servers = {"dgxb200": {"id": "x:dgxb200", "gpu": "b200", "gpuCount": 8, "priceUsd": 562154.09, "powerKw": 14.3},
               "rtx4": {"id": "x:rtx4", "gpu": "rtx6000pro", "gpuCount": 4, "priceUsd": 118074, "powerKw": 3.705}}
    return {"models": models, "gpus": gpus, "prices": prices, "offers": offers, "servers": servers,
            "buyDefaults": BUY_DEFAULTS}


def make_golden(fx):
    M = {m["id"]: m for m in fx["models"]}
    G = {g["id"]: g for g in fx["gpus"]}
    cases = []

    def add(kind, args, result):
        cases.append({"kind": kind, "args": args, "result": result})

    steps = [("qwen3.8-27b", 4, "rtx6000pro", 1, 4000, 500, c) for c in (1, 16, 64)]
    steps += [("qwen3.8-27b", 8, "h100", 1, 2000, 300, 32), ("qwen3.8-27b", 16, "h200", 1, 1000, 1000, 8),
              ("deepseek-v4.1-flash", 4, "b200", 8, 4000, 500, 1), ("deepseek-v4.1-flash", 4, "b200", 8, 4000, 500, 64),
              ("deepseek-v4.1-flash", 4, "b200", 8, 4000, 500, 512), ("gemma-4-31b", 8, "mi300x", 1, 1000, 500, 128),
              ("muse-spark-open", 4, "b200", 8, 8000, 1000, 100), ("nemotron-3.5-super-vl", 4, "h100", 4, 4000, 500, 40)]
    for mid, bits, gid, g, isl, osl, conc in steps:
        for mtp in (False, True):
            args = {"model": mid, "bits": bits, "gpu": gid, "g": g, "isl": isl, "osl": osl, "conc": conc,
                    "opts": {"mtp": mtp, "cachedShare": 0.5 if mtp else 0.0}}
            add("stepModel", args, step_model(M[mid], bits, G[gid], g, isl, osl, conc, mtp, args["opts"]["cachedShare"]))
    for mid, bits, gid, g, isl, osl, conc, ctx in (("qwen3.8-27b", 4, "rtx6000pro", 1, 4000, 500, 64, 262144),
                                                  ("deepseek-v4.1-flash", 4, "b200", 8, 4000, 500, 512, 262144),
                                                  ("kimi-k3.1-pro", 4, "b300", 8, 4000, 500, 64, 262144)):
        args = {"model": mid, "bits": bits, "gpu": gid, "g": g, "isl": isl, "osl": osl, "conc": conc,
                "opts": {"mtp": False, "cachedShare": 0.0, "ctx": ctx}}
        add("stepModel", args, step_model(M[mid], bits, G[gid], g, isl, osl, conc, False, 0.0, ctx=ctx))
    for mid in M:
        for bits in (4, 8, 16):
            for gid in G:
                for ctx in (8192, 131072):
                    add("minGpus", {"model": mid, "bits": bits, "gpu": gid, "ctx": ctx},
                        {"g": min_gpus(M[mid], bits, G[gid], ctx)})
    deps = [("qwen3.8-27b", 8, "h100", 1000, 4000, 500, 30, 0.0, 32768, False, 1.0),
            ("qwen3.8-27b", 4, "rtx6000pro", 200, 4000, 500, 30, 0.5, 32768, False, 1.0),
            ("qwen3.8-27b", 4, "rtx6000pro", 200, 4000, 500, 30, 0.5, 32768, False, 0.5),
            ("deepseek-v4.1-flash", 4, "b200", 3000, 6000, 600, 40, 0.0, 131072, True, 1.0),
            ("kimi-k3.1-pro", 4, "b200", 100, 4000, 500, 30, 0.0, 32768, False, 1.0),
            ("gemma-4-31b", 16, "h200", 5000, 1000, 400, 150, 0.0, 16384, False, 1.0),
            ("qwen3.8-27b", 4, "rtx6000pro", 200, 4000, 500, 30, 0.0, 262144, False, 1.0),
            ("qwen3.8-27b", 4, "b200", 200, 4000, 500, 30, 0.0, 262144, False, 1.0),
            ("deepseek-v4.1-flash", 4, "b200", 3000, 6000, 600, 40, 0.0, 262144, True, 1.0),
            ("qwen3.8-27b", 4, "rtx6000pro", 0.25, 4000, 500, 30, 0.5, 262144, False, 1.0),
            ("qwen3.8-27b", 4, "rtx6000pro", 0.01, 4000, 500, 30, 0.5, 262144, False, 1.0),
            ("kimi-k3.1-pro", 4, "b300", 0.5, 4000, 500, 30, 0.0, 262144, False, 1.0)]
    for mid, bits, gid, C, isl, osl, v, h, ctx, mtp, tf in deps:
        inp = {"model": mid, "bits": bits, "gpu": gid, "C": C, "isl": isl, "osl": osl, "v": v,
               "cachedShare": h, "ctx": ctx, "mtp": mtp, "tf": tf}
        args = {k: val for k, val in inp.items() if k not in ("model", "gpu")}
        args["model"], args["gpu"] = mid, gid
        add("sizeDeployment", args, size_deployment({**inp, "model": M[mid], "gpu": G[gid]}))
    for pname, price in fx["prices"].items():
        for isl in (1000, 150000, 300000):
            for h in (0.0, 0.9):
                add("apiCostPerRequest", {"price": pname, "isl": isl, "osl": 500, "cachedShare": h},
                    {"usd": api_cost_per_request(price, isl, 500, h)})
        args = {"price": pname, "C": 250, "isl": 4000, "osl": 500, "cachedShare": 0.5, "v": 30, "ttftS": 0.5, "hoursPerDay": 10}
        add("apiMonthly", args, api_monthly(price, 250, 4000, 500, 0.5, 30, 0.5, 10))
        for frac in (0.01, 0.25):
            fargs = {**args, "C": frac}
            add("apiMonthly", fargs, api_monthly(price, frac, 4000, 500, 0.5, 30, 0.5, 10))
    dep = size_deployment({"model": M["qwen3.8-27b"], "gpu": G["h100"], "bits": 8, "C": 1000, "isl": 4000, "osl": 500,
                           "v": 30, "cachedShare": 0.0, "ctx": 32768, "mtp": False, "tf": 1.0})
    for oname, offer in fx["offers"].items():
        add("rentMonthly", {"deployment": dep, "offer": oname, "hoursPerDay": 12}, rent_monthly(dep, offer, 12))
    dep_b = size_deployment({"model": M["qwen3.8-27b"], "gpu": G["rtx6000pro"], "bits": 4, "C": 300, "isl": 4000, "osl": 500,
                             "v": 30, "cachedShare": 0.5, "ctx": 32768, "mtp": False, "tf": 1.0})
    for sname, srv in fx["servers"].items():
        add("buyMonthly", {"deployment": dep_b, "server": sname}, buy_monthly(dep_b, srv, BUY_DEFAULTS))
        d2 = {**BUY_DEFAULTS, "coloIncludesEnergy": True, "residualPct": 20}
        add("buyMonthly", {"deployment": dep_b, "server": sname, "defaults": {"coloIncludesEnergy": True, "residualPct": 20}},
            buy_monthly(dep_b, srv, d2))
    for c0, d, o, N, caching in ((20000, 5000, 1000, 50, False), (20000, 5000, 1000, 50, True), (4000, 500, 500, 1, True)):
        add("agentLoop", {"c0": c0, "d": d, "o": o, "N": N, "caching": caching}, agent_loop(c0, d, o, N, caching))
    cs = [1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233, 377, 610, 987, 1597, 2584, 4181, 6765, 10000]
    inp = {"model": M["qwen3.8-27b"], "gpu": G["h100"], "bits": 8, "isl": 4000, "osl": 500, "v": 30, "cachedShare": 0.0,
           "ctx": 32768, "mtp": False, "ttftS": 0.5, "hoursPerDay": 24}
    price = fx["prices"]["plain"]
    sw = sweep(inp, cs, price, lambda dep, tok: rent_monthly(dep, fx["offers"]["h100x4"], 24)["usdPerMonth"])
    add("sweep+crossover", {"model": "qwen3.8-27b", "gpu": "h100", "bits": 8, "price": "plain", "offer": "h100x4", "cs": cs,
                            "isl": 4000, "osl": 500, "v": 30, "cachedShare": 0.0, "ctx": 32768, "ttftS": 0.5, "hoursPerDay": 24},
        {"sweep": sw, "crossover": crossover(sw, cs)})
    # a sweep that starts below one stream: a machine costs the same however little it is used, the API bill shrinks
    cs2 = [0.01, 0.03, 0.1, 0.3, 1, 3, 10, 30]
    inp2 = {"model": M["qwen3.8-27b"], "gpu": G["rtx6000pro"], "bits": 4, "isl": 4000, "osl": 500, "v": 30, "cachedShare": 0.5,
            "ctx": 262144, "mtp": False, "ttftS": 0.5, "hoursPerDay": 24}
    sw2 = sweep(inp2, cs2, fx["prices"]["plain"], lambda dep, tok: rent_monthly(dep, fx["offers"]["rtx1"], 24)["usdPerMonth"])
    add("sweep+crossover", {"model": "qwen3.8-27b", "gpu": "rtx6000pro", "bits": 4, "price": "plain", "offer": "rtx1", "cs": cs2,
                            "isl": 4000, "osl": 500, "v": 30, "cachedShare": 0.5, "ctx": 262144, "ttftS": 0.5, "hoursPerDay": 24},
        {"sweep": sw2, "crossover": crossover(sw2, cs2)})
    return {"cases": cases}


def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else "fixtures"
    if cmd == "fixtures":
        fx = make_fixtures()
        gold = make_golden(fx)
        (OUT / "fixtures.json").write_text(json.dumps(fx, indent=1))
        (OUT / "golden.json").write_text(json.dumps(gold, indent=1))
        print(f"fixtures: {len(fx['models'])} models, {len(fx['gpus'])} gpus; golden cases: {len(gold['cases'])}")
    else:
        d = Path(sys.argv[2])
        M = {m["id"]: m for m in json.load(open(d / "models.json"))}
        G = {g["id"]: g for g in json.load(open(d / "gpus.json"))}
        m, g = M["qwen3.8-27b"], G["rtx6000pro"]
        for c in (1, 16, 64):
            print(c, {k: round(v, 3) for k, v in step_model(m, 4, g, 1, 4000, 500, c).items()})


if __name__ == "__main__":
    main()
