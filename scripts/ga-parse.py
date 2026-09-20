#!/usr/bin/env python3
"""Parse production tick outcomes observed in GitHub Actions run logs (read-only).
Input: scripts/ga_work/ticks_raw.txt — lines: "<UTC date> <run id> {json...}"
JSON may be truncated at 2000 chars (workflow does `head -c 2000`).
Output: per-symbol action counts, every BUY/SELL event with timestamp+reason."""
import re, json, sys
from collections import defaultdict, Counter
from datetime import datetime, timezone

RAW = "/home/z/my-project/scripts/ga_work/ticks_raw.txt"

obj_re = re.compile(r"\{[^{}]*\}")

def parse_line(line: str):
    parts = line.split(" ", 2)
    if len(parts) < 3:
        return None
    date, run_id, blob = parts
    out = []
    for m in obj_re.finditer(blob):
        span = m.group(0)
        if '"action"' not in span:
            continue
        def grab(key):
            mm = re.search(rf'"{key}"\s*:\s*("[^"]*"|-?[0-9][0-9.eE+-]*|null|true|false)', span)
            if not mm:
                return None
            v = mm.group(1)
            if v.startswith('"'):
                v = v[1:-1]
            return v
        action = grab("action")
        symbol = grab("symbol")
        if not action or not symbol:
            continue
        out.append({
            "date": date, "run": run_id, "action": action, "symbol": symbol,
            "reason": grab("reason"), "score": grab("score"), "pnl": grab("pnlUsdt"),
        })
    return out

events = []
runs_by_day = Counter()
symbols_seen = set()
with open(RAW) as f:
    for line in f:
        line = line.rstrip("\n")
        if not line.strip():
            continue
        parsed = parse_line(line)
        if not parsed:
            continue
        day = parsed[0]["date"][:10]
        runs_by_day[day] += 1
        for e in parsed:
            symbols_seen.add(e["symbol"])
            events.append(e)

print("== Cakupan log GA (UTC) ==")
for day in sorted(runs_by_day):
    print(f"  {day}: {runs_by_day[day]} run")
print(f"  total run: {sum(runs_by_day.values())}")

print("\n== Simbol yang terlihat di produksi ==")
print("  " + ", ".join(sorted(symbols_seen)))

counts = defaultdict(Counter)
for e in events:
    counts[e["symbol"]][e["action"]] += 1
print("\n== Aksi per simbol (hanya pada momen tick yang di-sample GA) ==")
for sym in sorted(counts):
    c = counts[sym]
    tot = sum(c.values())
    print(f"  {sym:14s} total={tot:4d}  " + "  ".join(f"{a}={c[a]}" for a in sorted(c)))

print("\n== Semua event BUY ==")
buy = [e for e in events if e["action"] == "BUY"]
for e in sorted(buy, key=lambda x: x["date"]):
    sc = f" score={e['score']}" if e["score"] else ""
    print(f"  {e['date']}  {e['symbol']:12s}{sc}  {e['reason']}")
print(f"  total BUY terlihat: {len(buy)}")

print("\n== Semua event SELL (exit) ==")
sell = [e for e in events if e["action"] == "SELL"]
pnl_sum = 0.0
pnl_n = 0
for e in sorted(sell, key=lambda x: x["date"]):
    p = ""
    if e["pnl"] not in (None, "null"):
        try:
            v = float(e["pnl"]); pnl_sum += v; pnl_n += 1
            p = f" pnl={v:+.4f} USDT"
        except ValueError:
            pass
    print(f"  {e['date']}  {e['symbol']:12s}{p}  {e['reason']}")
print(f"  total SELL terlihat: {len(sell)}  (pnl tercatat: {pnl_n}, sum={pnl_sum:+.4f} USDT)")
