/**
 * E2E verify — Bitget-real live limit entry + OCO (Task 16).
 *
 * Strategy: real orders are impossible here, so we seed a FAKE (encrypted)
 * Bitget connection. Every signed call is rejected by the exchange (HTTP
 * 401), which is exactly the graceful-degradation surface we want to prove:
 * the engine must always survive an unreachable/unauthorized exchange
 * without crashing, without losing state, and without paper regressions.
 *
 *  1. register fresh user
 *  2. create LIVE bot BTCUSDT (confirmLive) → echo paper=false
 *  3. GET → spot wallet present (available null — no connection), pending null
 *  4. tick without any connection → ERROR "no bitget connection" + FAILED log
 *  5. seed fake creds → tick → survives signed-401 (HOLD/ERROR, no position)
 *  6. stale pending without orderId → cleared by the tick
 *  7. armed pending with fake orderId (fresh) → "waiting live limit", state kept
 *  8. same pending at TTL → cancel 401 → "TTL hit but cancel failed", state kept
 *  9. live quota: 2nd live bot ok, 3rd → 409 quota_live
 * 10. paper bot → no `spot` payload (live wallet never leaks to paper)
 * 11. unit: classifyOrderStatus / clipToPrecision / planLimitBuySize
 * 12. cleanup — delete the whole test user
 */
const BASE = "http://localhost:3000";
const { createClient } = await import("@libsql/client");

let cookie = "";
async function call(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: body ? JSON.stringify(body) : undefined,
  });
  const sc = res.headers.getSetCookie?.() ?? [];
  if (sc.length) cookie = sc.map((c) => c.split(";")[0]).join("; ");
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, json };
}

const fails = [];
function check(name, ok, extra = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? ` — ${extra}` : ""}`);
  if (!ok) fails.push(name);
}

/* 1 — register */
const email = `liveoco-${Date.now()}@test.local`;
const reg = await call("POST", "/api/auth/register", { email, password: "secret123", name: "L" });
check("register", reg.status === 200 || reg.status === 201);

/* 2 — live bot with explicit confirm */
const mkLive = (sym) => call("PUT", "/api/bot", {
  mode: "AGGRESSIVE", symbol: sym, paper: false, enabled: false, confirmLive: true,
  orderSizeUsdt: 5, maxTradesPerDay: 4, dailyLossLimitUsdt: 20,
});
const r1 = await mkLive("BTCUSDT");
check("create LIVE BTCUSDT (confirmLive)", (r1.status === 200 || r1.status === 201) && r1.json?.config?.paper === false, `paper=${r1.json?.config?.paper}`);

/* 3 — GET shape for a live bot without a connection */
const g1 = await call("GET", "/api/bot?symbol=BTCUSDT");
check("GET live: spot wallet present, available null", g1.json?.spot && "available" in g1.json.spot && g1.json.spot.available === null, JSON.stringify(g1.json?.spot));
check("GET live: no pending entry", g1.json?.pending === null);

async function tick() {
  const res = await call("POST", "/api/bot/tick");
  const map = {};
  for (const r of res.json?.results ?? []) map[r.symbol] = r;
  return map;
}

/* 4 — tick without connection: must fail safely and audit-log */
const t1 = await tick();
const b1 = t1.BTCUSDT ?? {};
check("no connection → ERROR no bitget connection", b1.action === "ERROR" && String(b1.reason).includes("no bitget connection"), `${b1.action} · ${b1.reason}`);
const db = createClient({ url: "file:db/custom.db" });
const uid = (await db.execute({ sql: "SELECT id FROM User WHERE email = ?", args: [email] })).rows[0].id;
const cfgBtc = (await db.execute({ sql: "SELECT id FROM BotConfig WHERE userId = ? AND symbol = 'BTCUSDT'", args: [uid] })).rows[0].id;
const failedLog = await db.execute({
  sql: "SELECT COUNT(*) AS n FROM BotTrade WHERE configId = ? AND status = 'FAILED' AND reason LIKE '%no active Bitget connection%'",
  args: [cfgBtc],
});
check("failure audit-logged", Number(failedLog.rows[0].n) >= 1, `n=${failedLog.rows[0].n}`);

/* 5 — seed fake creds: signed calls now 401, tick must survive */
const { encryptSecret } = await import("../src/lib/secure.ts");
await db.execute({
  sql: `INSERT INTO ExchangeConnection (id, userId, exchange, label, apiKeyEnc, apiSecretEnc, apiPassphraseEnc, apiKeyMasked, apiKeyHash, status, createdAt, updatedAt)
        VALUES (?, ?, 'bitget', 'fake', ?, ?, ?, 'fake••••key', 'fakehash', 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
  args: [`fake-conn-${Date.now()}`, uid, encryptSecret("fake-key"), encryptSecret("fake-secret"), encryptSecret("fake-pass")],
});
const t2 = await tick();
const b2 = t2.BTCUSDT ?? {};
check("fake creds tick survives signed-401", ["HOLD", "ERROR"].includes(b2.action), `${b2.action} · ${b2.reason}`);
const posCount = await db.execute({ sql: "SELECT COUNT(*) AS n FROM BotPosition WHERE configId = ? AND status = 'OPEN'", args: [cfgBtc] });
check("no position created against fake creds", Number(posCount.rows[0].n) === 0, `n=${posCount.rows[0].n}`);

/* 6 — stale pending (price without orderId) is dropped, never acted on */
await db.execute({
  sql: "UPDATE BotConfig SET pendingEntryPrice = 999999, pendingEntrySize = 5, pendingEntryAt = ? WHERE id = ?",
  args: [Date.now() - 5 * 60_000, cfgBtc],
});
const t3 = await tick();
const b3 = t3.BTCUSDT ?? {};
check("stale pending cleared", String(b3.reason).includes("stale pending limit without orderId cleared"), `${b3.action} · ${b3.reason}`);
const p3 = await db.execute({ sql: "SELECT pendingEntryPrice FROM BotConfig WHERE id = ?", args: [cfgBtc] });
check("stale pending state null after clear", p3.rows[0].pendingEntryPrice == null);

/* 7 — armed pending + fake orderId, fresh → orderInfo 401 → UNKNOWN → keep waiting */
await db.execute({
  sql: "UPDATE BotConfig SET pendingEntryPrice = 0.0000001, pendingEntrySize = 5, pendingEntryAt = ?, pendingEntryOrderId = '9999999999' WHERE id = ?",
  args: [Date.now() - 2 * 60_000, cfgBtc],
});
const t4 = await tick();
const b4 = t4.BTCUSDT ?? {};
check("unreachable orderInfo → keep waiting", b4.action === "HOLD" && String(b4.reason).startsWith("waiting live limit"), `${b4.action} · ${b4.reason}`);
const p4 = await db.execute({ sql: "SELECT pendingEntryOrderId FROM BotConfig WHERE id = ?", args: [cfgBtc] });
check("pending state kept while waiting", p4.rows[0].pendingEntryOrderId === "9999999999");

/* 8 — TTL elapsed → cancel 401 → explicit retry-next-tick, state kept */
await db.execute({
  sql: "UPDATE BotConfig SET pendingEntryAt = ? WHERE id = ?",
  args: [Date.now() - 11 * 3600_000, cfgBtc],
});
const t5 = await tick();
const b5 = t5.BTCUSDT ?? {};
check("TTL + cancel-401 → retry next tick", b5.action === "HOLD" && String(b5.reason).startsWith("TTL hit but cancel failed"), `${b5.action} · ${b5.reason}`);
const p5 = await db.execute({ sql: "SELECT pendingEntryOrderId FROM BotConfig WHERE id = ?", args: [cfgBtc] });
check("pending kept after failed cancel (order may still be live)", p5.rows[0].pendingEntryOrderId === "9999999999");

/* 9 — live quota (max 2) */
const r2 = await mkLive("ETHUSDT");
check("2nd live bot allowed", r2.status === 200 || r2.status === 201);
const r3 = await mkLive("LITUSDT");
check("3rd live bot blocked 409", r3.status === 409 && r3.json?.error === "quota_live", `${r3.status}`);

/* 10 — paper bot never gets the live-wallet payload */
const mkPaper = call("PUT", "/api/bot", {
  mode: "AGGRESSIVE", symbol: "LITUSDT", paper: true, enabled: false,
  orderSizeUsdt: 5, maxTradesPerDay: 4, dailyLossLimitUsdt: 20,
});
const paperStatus = (await mkPaper).status;
check("paper bot created", paperStatus === 200 || paperStatus === 201);
const g2 = await call("GET", "/api/bot?symbol=LITUSDT");
check("paper bot: spot payload absent", g2.json?.spot === null || g2.json?.spot === undefined, JSON.stringify(g2.json?.spot));

/* 11 — unit tests of the pure Bitget-real helpers */
const bt = await import("../src/lib/bot/bitget-trade.ts");
check("classify: full_fill → FILLED", bt.classifyOrderStatus("full_fill") === "FILLED");
check("classify: filled → FILLED", bt.classifyOrderStatus("filled") === "FILLED");
check("classify: partially_filled → PARTIAL", bt.classifyOrderStatus("partially_filled") === "PARTIAL");
check("classify: cancelled → CANCELLED", bt.classifyOrderStatus("cancelled") === "CANCELLED");
check("classify: new → OPEN", bt.classifyOrderStatus("new") === "OPEN");
check("classify: garbage → UNKNOWN (never guess)", bt.classifyOrderStatus("weird-state") === "UNKNOWN");
check("clip: 0.0123456789 @4dp → 0.0123 (round DOWN)", bt.clipToPrecision(0.0123456789, 4) === "0.0123");
check("clip: 77570.6789 @2dp → 77570.67", bt.clipToPrecision(77570.6789, 2) === "77570.67");
const sizing = bt.planLimitBuySize({ marketPrice: 100, level: 99.5, budgetUsdt: 5, minOrderUsdt: 5, availableUsdt: 20, quantityPrecision: 4 });
check("sizing: 5 USDT @99.5 bumped to min step 0.0503 → 5.00485", sizing?.qty === "0.0503" && Math.abs(sizing.notional - 5.00485) < 1e-9, JSON.stringify(sizing));
const sizingMin = bt.planLimitBuySize({ marketPrice: 100, level: 99.5, budgetUsdt: 5, minOrderUsdt: 5, availableUsdt: 4.9, quantityPrecision: 4 });
check("sizing: insufficient funds → null", sizingMin === null, JSON.stringify(sizingMin));
const sizingBump = bt.planLimitBuySize({ marketPrice: 100, level: 99.5, budgetUsdt: 5, minOrderUsdt: 5, availableUsdt: 20, quantityPrecision: 1 });
check("sizing: precision dip bumped to min", sizingBump !== null && Number(sizingBump.qty) * 99.5 >= 5 - 0.05, JSON.stringify(sizingBump));

console.log(fails.length ? `\n${fails.length} FAILURES` : "\nALL PASS");

/* 12 — cleanup */
const { PrismaClient } = await import("@prisma/client");
const p = new PrismaClient();
await p.user.delete({ where: { email } }).catch(() => {});
await p.$disconnect();
console.log("cleanup done (test user removed)");
process.exit(fails.length ? 1 : 0);
