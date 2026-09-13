/**
 * Read-only investigation: why do the bot's Sep-11 paper fills (~$82) not
 * match Bitget's CURRENT candle history (~$4.5 on Sep 11)?
 *  1. 5m candles around Sep 11 13:00-16:00 UTC (when the bot traded).
 *  2. Bitget spot symbols containing "LIT" / "HEI" (ticker switch?).
 *  3. CoinGecko cross-check: litentry/heima price now & on Sep 11.
 * Run: bun scripts/investigate-lit.ts
 */
const BG = "https://api.bitget.com";
const CG = "https://api.coingecko.com/api/v3";

async function jget(base: string, path: string): Promise<any> {
  const res = await fetch(`${base}${path}`);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}`);
  const body = await res.json();
  return body;
}

const fmt = (ms: number) => new Date(ms).toISOString().replace("T", " ").slice(0, 16) + "Z";

async function main() {
  /* 1. 5m candles at the trade window: 2026-09-11 12:00-16:30 UTC */
  const end = Date.parse("2026-09-11T16:30:00Z");
  const c5 = await jget(BG, `/api/v2/spot/market/candles?symbol=LITUSDT&granularity=5min&limit=60&endTime=${end}`);
  const rows = (c5.data ?? []).slice(-40);
  console.log("--- Bitget LITUSDT 5m candles, 2026-09-11 ~12:30-16:30 UTC (bot traded 13:00-15:54Z) ---");
  for (const r of rows) {
    const [, o, h, l, c] = r.map(Number);
    console.log(`${fmt(Number(r[0]))}  O ${o.toFixed(4).padStart(10)}  H ${h.toFixed(4).padStart(10)}  L ${l.toFixed(4).padStart(10)}  C ${c.toFixed(4).padStart(10)}`);
  }

  /* 2. symbols containing LIT or HEI */
  const syms = await jget(BG, `/api/v2/spot/public/symbols`);
  const list = (syms.data ?? []).filter((s: any) => /LIT|HEI/.test(s.symbol));
  console.log("\n--- Bitget spot symbols matching LIT/HEI ---");
  for (const s of list) {
    console.log(`${s.symbol}  base=${s.baseCoin} quote=${s.quoteCoin} status=${s.status ?? "?"}`);
  }

  /* 3. CoinGecko cross-check */
  try {
    const now = await jget(CG, `/simple/price?ids=litentry,heima&vs_currencies=usd&include_24hr_change=true`);
    console.log("\n--- CoinGecko now ---");
    console.log(JSON.stringify(now));
  } catch (e) { console.log("CG simple/price failed:", (e as Error).message); }

  try {
    const mc = await jget(CG, `/coins/litentry/market_chart?vs_currency=usd&days=30&interval=daily`);
    const prices = (mc.prices ?? []) as [number, number][];
    console.log("\n--- CoinGecko litentry daily (last 30d) ---");
    for (const [ts, p] of prices) {
      console.log(`${new Date(ts).toISOString().slice(0, 16)}Z  $${p}`);
    }
  } catch (e) { console.log("CG market_chart failed:", (e as Error).message); }
}

main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
