"""Traffic for the routing simulation. Standard library only.

Sends POST /v1/chat/completions to the gateway and counts which fake model server answered, using the x-served-by
response header (the fake server puts its pod name there and the gateway passes it through).

Experiments, run in the order you list them (default: all five, in this order):
  shared     30 requests, one at a time, the same long system prompt, only the last line differs
  unique     30 requests, one at a time, every request has its own long system prompt
             (one at a time means: send, wait for the answer, pause 0.1 s, send the next; see --pause)
  burst      20 requests with different prompts, all released at the same instant, on an idle pool
  burst-busy the same burst, while two background senders keep two pods busy (their requests are in the row background)
  sustained  12 senders, back to back, on the shared prompt, for 30 seconds

The shared prompt is made fresh on every start of this script, so every start begins cold. Experiments listed in one
start (for example "shared sustained") reuse the same shared prompt, so "sustained" begins with one warm pod.

Usage: python3 traffic.py [--url http://127.0.0.1:8080] [--seconds 30] [--pause 0.1] [shared unique burst burst-busy sustained]
"""
import argparse
import json
import random
import statistics
import threading
import time
import urllib.error
import urllib.request
from collections import Counter
from concurrent.futures import ThreadPoolExecutor

MODEL = "qwen38-27b-nvfp4"
RUN_ID = str(time.time_ns())          # makes every start of this script use prompts the pods have never seen
WORDS = ("alpha beta gamma delta kernel socket queue token cache block prefix latency router pod node cluster "
         "gateway request response stream batch decode prefill memory shard replica metric signal budget policy "
         "limit retry timeout window sample series label bucket quantile ratio deploy rollout probe "
         "scheduler endpoint upstream downstream filter header buffer packet frame").split()
SYSTEM_CHARS = 3000                   # about 750 tokens, about 12 prefix blocks of 256 characters
PAUSE_S = 5                           # between experiments, so the pods drain and the picker settles
SENDERS = 12


def system_prompt(seed):
    rng = random.Random(seed)
    out = ["You are a support assistant for an internal platform team. Follow the house style."]
    while sum(len(s) + 1 for s in out) < SYSTEM_CHARS:
        out.append(" ".join(rng.choice(WORDS) for _ in range(12)).capitalize() + ".")
    return " ".join(out)


SHARED = system_prompt(f"shared-{RUN_ID}")


def send(system, i, url, t0):
    """One request. Returns (seconds since the experiment began, HTTP status, pod name or None, latency in seconds)."""
    body = json.dumps({"model": MODEL, "max_tokens": 8, "messages": [
        {"role": "system", "content": system},
        {"role": "user", "content": f"Question {i}: summarise item {i} in one line."}]}).encode()
    req = urllib.request.Request(url + "/v1/chat/completions", data=body, headers={"Content-Type": "application/json"})
    start = time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            r.read()
            status, pod = r.status, r.headers.get("x-served-by")
    except urllib.error.HTTPError as e:
        status, pod = e.code, e.headers.get("x-served-by")
    except Exception:                 # connection reset or timeout: counted as not 200, never hidden
        status, pod = 0, None
    return (start - t0, status, pod, time.monotonic() - start)


def one_at_a_time(n, prompt_of, url, pause):
    t0, out = time.monotonic(), []
    for i in range(n):
        out.append(send(prompt_of(i), i, url, t0))
        time.sleep(pause)
    return out


def all_at_once(n, prompt_of, url):
    t0, gate = time.monotonic(), threading.Barrier(n)

    def worker(i):
        gate.wait()
        return send(prompt_of(i), i, url, t0)

    with ThreadPoolExecutor(max_workers=n) as pool:
        return list(pool.map(worker, range(n)))


def back_to_back(senders, seconds, prompt_of, url):
    t0 = time.monotonic()
    stop, counter, lock, out = t0 + seconds, iter(range(10**9)), threading.Lock(), []

    def worker(_):
        while time.monotonic() < stop:
            with lock:
                i = next(counter)
            rec = send(prompt_of(i), i, url, t0)
            with lock:
                out.append(rec)

    with ThreadPoolExecutor(max_workers=senders) as pool:
        list(pool.map(worker, range(senders)))
    return out


def busy_burst(url):
    background = []
    sender = threading.Thread(target=lambda: background.extend(
        back_to_back(2, 8, lambda i: system_prompt(f"{RUN_ID}-bg-{i}"), url)))
    sender.start()
    time.sleep(2)                     # let the two background requests settle on two pods
    recs = all_at_once(20, lambda i: system_prompt(f"{RUN_ID}-busy-{i}"), url)
    sender.join()
    return {"burst-busy": recs, "background": background}      # the background requests get their own row


def run(name, url, seconds, pause):
    """Returns {row name: records}."""
    if name == "shared":
        return {name: one_at_a_time(30, lambda i: SHARED, url, pause)}
    if name == "unique":
        return {name: one_at_a_time(30, lambda i: system_prompt(f"{RUN_ID}-unique-{i}"), url, pause)}
    if name == "burst":
        return {name: all_at_once(20, lambda i: system_prompt(f"{RUN_ID}-burst-{i}"), url)}
    if name == "burst-busy":
        return busy_burst(url)
    return {name: back_to_back(SENDERS, seconds, lambda i: SHARED, url)}   # sustained


def short(pod):
    return pod.rsplit("-", 1)[-1]     # the 5 character suffix of the pod name


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://127.0.0.1:8080")
    ap.add_argument("--seconds", type=int, default=30, help="length of the sustained experiment")
    ap.add_argument("--pause", type=float, default=0.1, help="seconds between the one at a time requests")
    ap.add_argument("experiments", nargs="*", choices=["shared", "unique", "burst", "burst-busy", "sustained"])
    a = ap.parse_args()
    names = a.experiments or ["shared", "unique", "burst", "burst-busy", "sustained"]

    results = {}
    for k, name in enumerate(names):
        if k:
            time.sleep(PAUSE_S)
        results.update(run(name, a.url, a.seconds, a.pause))
        recs = results[name]
        by_pod = Counter(short(p) for _, st, p, _ in recs if st == 200 and p)
        print(f"done {name}: {len(recs)} requests, " + ", ".join(f"{p} {n}" for p, n in sorted(by_pod.items())), flush=True)

    pods = sorted({short(p) for recs in results.values() for _, st, p, _ in recs if st == 200 and p})
    print("\nrequests answered by each fake pod")
    print(f"{'experiment':<11}{'requests':>9}  " + "".join(f"{p:>7}" for p in pods) + f"{'top share':>11}{'not 200':>9}{'median s':>10}{'max s':>7}")
    total = Counter()
    for name, recs in results.items():
        by_pod = Counter(short(p) for _, st, p, _ in recs if st == 200 and p)
        total.update(by_pod)
        ok = sum(by_pod.values())
        lat = [x for *_, x in recs]
        top = f"{100 * max(by_pod.values(), default=0) // max(ok, 1)}%"
        print(f"{name:<11}{len(recs):>9}  " + "".join(f"{by_pod.get(p, 0):>7}" for p in pods)
              + f"{top:>11}{len(recs) - ok:>9}{statistics.median(lat):>10.2f}{max(lat):>7.2f}")
    print(f"{'all sent':<11}{sum(total.values()):>9}  " + "".join(f"{total.get(p, 0):>7}" for p in pods))

    if "sustained" in results:        # when did each pod start getting requests? (requests started per pod per second)
        print("\nsustained: requests started in each of the first 6 seconds")
        print(f"{'second':<11}" + "".join(f"{p:>7}" for p in pods))
        for s in range(6):
            c = Counter(short(p) for t, st, p, _ in results["sustained"] if st == 200 and p and s <= t < s + 1)
            print(f"{s:>2} to {s + 1:<6}" + "".join(f"{c.get(p, 0):>7}" for p in pods))


if __name__ == "__main__":
    main()
