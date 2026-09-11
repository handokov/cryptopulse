/** Validation for /api/market/smallcaps (run against the dev server). */
const BASE = "http://localhost:3000";

let pass = 0;
let fail = 0;
function check(name, ok, detail = "") {
  if (ok) { pass++; console.log(`PASS  ${name}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`); }
}

async function getSmallcaps(minVol) {
  const res = await fetch(`${BASE}/api/market/smallcaps?minVol=${minVol}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function main() {
  const top = await (await fetch(`${BASE}/api/market/top100`, { cache: "no-store" })).json();
  const boardSyms = new Set(top.coins.map((c) => c.symbol.toUpperCase()));
  check("board loaded", top.coins.length >= 100, `${top.coins.length} coins`);

  const data = await getSmallcaps(200000);
  const rows = data.rows;
  check("minVol=200K returns rows", rows.length > 0, `total=${data.total} returned=${rows.length}`);
  check("capped at 60", rows.length <= 60, String(rows.length));
  check("total >= returned", data.total >= rows.length);

  const STABLES = new Set(["USDC","DAI","TUSD","FDUSD","USDP","PYUSD","USDE","USD1","EUR","EURI","AEUR","EURA","XUSD","UST","USDS","USDT"]);
  /* True invariant: nothing marked areaSymbol=yes (tokenized equities) leaks in. */
  const bgSymbols = await (await fetch("https://api.bitget.com/api/v2/spot/public/symbols")).json();
  const areaSyms = new Set((bgSymbols.data || []).filter((r) => r.areaSymbol === "yes").map((r) => r.symbol));
  const violations = {
    boardMember: rows.filter((r) => boardSyms.has(r.base)),
    stable: rows.filter((r) => STABLES.has(r.base)),
    tokenizedStock: rows.filter((r) => areaSyms.has(r.symbol)),
    leveraged: rows.filter((r) => /(3L|3S|5L|5S)$/.test(r.base)),
    belowThreshold: rows.filter((r) => r.volumeUsdt < 200000),
    badPrice: rows.filter((r) => !(r.price > 0)),
  };
  for (const [k, v] of Object.entries(violations)) {
    check(`no ${k}`, v.length === 0, v.slice(0, 3).map((r) => r.symbol).join(","));
  }
  const sortedOk = rows.every((r, i) => i === 0 || rows[i - 1].volumeUsdt >= r.volumeUsdt);
  check("sorted volume-desc", sortedOk);
  check("AIO-style small caps included (spot check: known non-board pairs exist)",
    rows.some((r) => !boardSyms.has(r.base) && r.volumeUsdt >= 200000));

  const d1m = await getSmallcaps(1000000);
  check("minVol=1M stricter", d1m.total <= data.total, `1M total=${d1m.total} vs 200K total=${data.total}`);
  check("minVol=1M all above threshold", d1m.rows.every((r) => r.volumeUsdt >= 1000000));

  const bad = await fetch(`${BASE}/api/market/smallcaps?minVol=abc`);
  check("invalid minVol falls back to default (200K)", bad.ok, String(bad.status));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error("crashed:", e); process.exit(1); });
