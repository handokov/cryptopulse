#!/usr/bin/env python3
"""Cek high OPNUSDT pada jendela posisi user (Sep 29, 2026, waktu Bangkok UTC+7).
Trade B: open ~15:45 UTC, close 16:49 UTC, entry 0.0543, TP 0.055386, exit 0.0545 (trailing)
Trade A: open ~13:58 UTC, close 15:15 UTC, entry 0.0549, TP 0.055998, exit 0.0553 (trailing)
Sumber: Bitget public candles v2 (tanpa auth)."""
import json
import urllib.request
from datetime import datetime, timezone

BASE = "https://api.bitget.com/api/v2/spot/market/candles"


def fetch(symbol, granularity, start_ms, end_ms, limit=1000):
    url = f"{BASE}?symbol={symbol}&granularity={granularity}&startTime={start_ms}&endTime={end_ms}&limit={limit}"
    with urllib.request.urlopen(url, timeout=30) as r:
        body = json.loads(r.read())
    if body.get("code") != "00000":
        raise RuntimeError(f"bitget error: {body}")
    # v2 spot candles row: [ts, open, high, low, close, baseVol, usdtVol, quoteVol]
    return body["data"]


def ms(dtstr):
    return int(datetime.strptime(dtstr, "%Y-%m-%d %H:%M").replace(tzinfo=timezone.utc).timestamp() * 1000)


def show(rows, label):
    hi = max(rows, key=lambda r: float(r[2]))
    ts = datetime.fromtimestamp(int(hi[0]) / 1000, tz=timezone.utc)
    print(f"{label}: bars={len(rows)} HIGH={hi[2]} @ {ts:%H:%M} UTC ({ts:%H:%M} Bangkok)")
    return float(hi[2])


# Jendela penuh 13:30-17:10 UTC
rows = fetch("OPNUSDT", "5min", ms("2026-09-29 13:30"), ms("2026-09-29 17:10"), limit=200)
full_hi = show(rows, "5min 13:30-17:10 UTC")

# Drill-down 1m di sekitar peak untuk wick presisi
peak_ts = int(max(rows, key=lambda r: float(r[2]))[0])
fine = fetch("OPNUSDT", "1min", peak_ts - 5 * 60_000, peak_ts + 10 * 60_000, limit=30)
fine_hi = show(fine, "1m sekitar peak")

# Per-segmen per trade
a = fetch("OPNUSDT", "5min", ms("2026-09-29 13:50"), ms("2026-09-29 15:15"), limit=100)
a_hi = show(a, "Trade A (13:50-15:15 UTC)")
b = fetch("OPNUSDT", "5min", ms("2026-09-29 15:40"), ms("2026-09-29 16:50"), limit=100)
b_hi = show(b, "Trade B (15:40-16:50 UTC)")

print()
print(f"TP Trade A (entry 0.0549 x1.02) = 0.055998 | high segmen = {a_hi} | tersentuh? {a_hi >= 0.055998}")
print(f"TP Trade B (entry 0.0543 x1.02) = 0.055386 | high segmen = {b_hi} | tersentuh? {b_hi >= 0.055386}")
print(f"Exit tercatat: A=0.0553 (+0.73%) B=0.0545 (+0.37%)")
