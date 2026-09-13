/**
 * Read-only check: LITUSDT daily candles — did the price really fall from
 * ~$82 (Sep 11, when the paper bot traded it) to ~$4 now, or did the ticker
 * switch to a different asset (migration/rebrand)? Prints last 30 daily
 * closes + the 5m window around the discontinuity if one exists.
 * Run: bun scripts/check-lit-history.ts
 */
const BASE = "https://api.bitget.com";

async function jget(path: string): Promise<any> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}`);
  const body = await res.json();
  if (body.code !== "00000") throw new Error(`bitget code ${body.code}: ${body.msg}`);
  return body.data;
}

function fmt(ms: number): string {
  return new Date(ms).toISOString().replace("T", " ").slice(0, 16) + "Z";
}

async function main() {
  const daily = await jget(`/api/v2/spot/market/candles?symbol=LITUSDT&granularity=1day&limit=30`);
  console.log("--- LITUSDT daily candles (last 30) ---");
  for (const r of daily) {
    const [, o, h, l, c] = r.map(Number);
    const chg = ((c - o) / o) * 100;
    console.log(`${fmt(Number(r[0]))}  O ${o.toFixed(4).padStart(10)}  H ${h.toFixed(4).padStart(10)}  L ${l.toFixed(4).padStart(10)}  C ${c.toFixed(4).padStart(10)}  ${chg >= 0 ? "+" : ""}${chg.toFixed(1)}%`);
  }

  /* find the biggest single-day gap and zoom into 5m candles around it */
  let worstIdx = -1;
  let worstPct = 0;
  for (let i = 1; i < daily.length; i++) {
    const prevC = Number(daily[i - 1][4]);
    const o = Number(daily[i][1]);
    const gap = ((o - prevC) / prevC) * 100;
    if (Math.abs(gap) > Math.abs(worstPct)) { worstPct = gap; worstIdx = i; }
  }
  if (worstIdx > 0 && Math.abs(worstPct) > 30) {
    const gapStart = Number(daily[worstIdx][0]);
    console.log(`\n--- gap ${worstPct.toFixed(1)}% at ${fmt(gapStart)} — 5m candles around it ---`);
    const after = await jget(`/api/v2/spot/market/candles?symbol=LITUSDT&granularity=5min&limit=50&endTime=${gapStart + 6 * 3600_000}`);
    const before = await jget(`/api/v2/spot/market/candles?symbol=LITUSDT&granularity=5min&limit=50&endTime=${gapStart - 1}`);
    for (const r of [...before.slice(-12), ...after.slice(0, 18)]) {
      const [, o, h, l, c] = r.map(Number);
      console.log(`${fmt(Number(r[0]))}  O ${o.toFixed(4).padStart(10)}  C ${c.toFixed(4).padStart(10)}`);
    }
  }
}

main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
