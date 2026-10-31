"""Print what the endpoint picker saw for each request. Standard library only.

Reads the picker's log (started with log level 5, see the README) on standard input and prints one line per request:
the time, then for every pod the score the picker gave it, the queue and running numbers it had scraped, and how old
those numbers were. The request goes to the pod with the highest score. Pods with the same score take turns.

Usage: kubectl --context kind-p4-sim logs -n llm deploy/qwen38-27b-nvfp4-epp --since=2m | python3 picks.py
"""
import json
import sys
from datetime import datetime, timezone


def seconds(stamp):    # "2026-10-31T11:46:38.04910449Z" -> seconds since the epoch
    whole = datetime.strptime(stamp[:19], "%Y-%m-%dT%H:%M:%S").replace(tzinfo=timezone.utc).timestamp()
    return whole + float("0" + stamp[19:].rstrip("Z"))


for line in sys.stdin:
    if "Selecting endpoints from candidates" not in line:
        continue
    entry = json.loads(line)
    now = seconds(entry["timestamp"])
    pods = sorted(entry["scored-endpoints"], key=lambda e: e["Endpoint"]["Name"])
    cells = [f'{e["Endpoint"]["Name"][-5:]} score {e["Score"]:.2f} queue {e["Endpoint"]["WaitingQueueSize"]}'
             f' running {e["Endpoint"]["RunningRequestsSize"]} age {1000 * (now - seconds(e["Endpoint"]["UpdateTime"])):3.0f} ms'
             for e in pods]
    print(entry["timestamp"][11:23] + "   " + "   ".join(cells))
