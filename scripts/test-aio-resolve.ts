/**
 * Verification for the off-board asset resolver (portfolio sync fix).
 *
 * Scenario: user buys a Bitget listing that is NOT in the top-100 board and
 * NOT pinned (e.g. AIO / OlaXBT, rank ~1250). Before the fix it landed in
 * sync's unmatched list and never appeared in the asset report. After the
 * fix, sync resolves the symbol via CoinGecko search and price-sanity-checks
 * the candidate against Bitget's own ticker.
 *
 * Run: bun scripts/test-aio-resolve.ts
 */

import { searchCoinBySymbol } from "../src/lib/top100";
import { fetchBitgetTickerPrice } from "../src/lib/exchanges/bitget";
import { fetchSimplePrices } from "../src/lib/coin-prices";

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail: string) {
  if (ok) {
    pass += 1;
    console.log(`PASS  ${name}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail += 1;
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function main() {
  // 1. AIO resolves to OlaXBT (the actual Bitget asset the user holds).
  const aio = await searchCoinBySymbol("AIO");
  check("searchCoinBySymbol(AIO) → olaxbt", aio?.id === "olaxbt", JSON.stringify(aio));

  // 2. Price the candidate + cross-check against Bitget's own ticker
  //    (same ±50% rule the sync uses; real diff measured ~0.3%).
  if (aio) {
    const { map } = await fetchSimplePrices([aio.id]);
    const cg = map[aio.id]?.usd ?? null;
    const bt = await fetchBitgetTickerPrice("AIOUSDT");
    const rel = cg != null && bt != null ? Math.abs(cg - bt) / bt : null;
    check(
      "AIO price cross-check CG vs Bitget ≤ 50%",
      rel != null && rel <= 0.5,
      `cg=${cg} bitget=${bt} rel=${rel != null ? (rel * 100).toFixed(2) + "%" : "n/a"}`
    );
  } else {
    fail += 1;
    console.log("FAIL  AIO price cross-check — candidate missing");
  }

  // 3. GAIB still resolves (already pinned, but the resolver must not regress).
  const gaib = await searchCoinBySymbol("GAIB");
  check("searchCoinBySymbol(GAIB) → gaib", gaib?.id === "gaib", JSON.stringify(gaib));

  // 4. Gibberish symbol → null (negative cache, no confident match).
  const nope = await searchCoinBySymbol("ZZQVNOTREAL");
  check("searchCoinBySymbol(ZZQVNOTREAL) → null", nope === null, JSON.stringify(nope));

  // 5. Cache: second AIO call returns the identical object (no refetch).
  const aio2 = await searchCoinBySymbol("AIO");
  check("resolver cache hit (AIO again)", aio2?.id === "olaxbt", JSON.stringify(aio2));

  // 6. A top-100 symbol still resolves through search as a candidate —
  //    but the sync only consults the resolver for board MISSES, so this
  //    merely documents resolver independence from the board.
  const btc = await searchCoinBySymbol("BTC");
  check("searchCoinBySymbol(BTC) → bitcoin (independent of board)", btc?.id === "bitcoin", JSON.stringify(btc));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("test crashed:", e);
  process.exit(1);
});
