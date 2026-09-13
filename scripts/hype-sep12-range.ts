/**
 * Read-only: HYPEUSDT 15m price range around the Sep-12 score-ready window
 * (11:45-13:45Z and the score peak 17:45Z) to illustrate the entry-line
 * touch gate. Run: bun scripts/hype-sep12-range.ts
 */
const BASE = "https://api.bitget.com";
async function jget(path: string): Promise<any> {
  const res = await fetch(`${BASE}${path}`);
  const body = await res.json();
  if (body.code !== "00000") throw new Error(`bitget ${body.code}`);
  return body.data;
}
const fmt = (ms: number) => new Date(ms).toISOString().slice(11, 16) + "Z";
async function main() {
  const end = Date.parse("2026-09-12T18:00:00Z");
  const rows = await jget(`/api/v2/spot/market/candles?symbol=HYPEUSDT&granularity=15min&limit=100&endTime=${end}`);
  const bars = rows.map((r: any[]) => ({ ts: Number(r[0]), h: Number(r[2]), l: Number(r[3]), c: Number(r[4]) })).sort((a: any, b: any) => a.ts - b.ts);
  console.log("HYPEUSDT 15m — blok 4 jam (min L / max H / close terakhir):");
  const blocks = new Map<number, { lo: number; hi: number; c: number }>();
  for (const b of bars) {
    const k = Math.floor(b.ts / (4 * 3600_000));
    const cur = blocks.get(k) ?? { lo: Infinity, hi: 0, c: 0 };
    cur.lo = Math.min(cur.lo, b.l); cur.hi = Math.max(cur.hi, b.h); cur.c = b.c;
    blocks.set(k, cur);
  }
  for (const [k, v] of [...blocks.entries()].sort((a, b) => a[0] - b[0])) {
    const start = k * 4 * 3600_000;
    const mark = (start <= Date.parse("2026-09-12T13:45:00Z") && start + 4 * 3600_000 >= Date.parse("2026-09-12T11:45:00Z")) ? "  ← jendela score-ready" : "";
    console.log(`${new Date(start).toISOString().slice(5, 16).replace("T", " ")}  L ${v.lo.toFixed(2)} – H ${v.hi.toFixed(2)}  (close ${v.c.toFixed(2)})${mark}`);
  }
}
main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
