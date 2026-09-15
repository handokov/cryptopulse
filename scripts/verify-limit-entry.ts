/**
 * E2E verify — paper maker-style limit entry (design Task 15).
 * Deterministic: the fill probe uses a level FAR ABOVE the market (low <=
 * level always true → fills at the bar open), the waiting/expiry probes use
 * a level FAR BELOW (never fills). Live tick via POST /api/bot/tick.
 *
 *  1. register fresh user
 *  2. create BTCUSDT with entryOffsetPct 0.5 → assert echo
 *  3. create ETHUSDT without offset → assert default 0.3
 *  4. PUT validation: −1 / 6 / "abc" → 400; 0 → ok (market entry mode)
 *  5. pure fns: armLimitLevel / limitFillPrice (gap → open, touch → level)
 *  6. FILL: seed pending level 999999 (age 5m) → tick → BUY "limit fill",
 *     position OPEN size 5, pending cleared
 *  7. WAITING: ETHUSDT pending level 1e-7 (age 2m) → tick → "waiting limit"
 *  8. TTL: age → 10h → tick → "limit re-armed" (state refreshed) OR
 *     "limit expired" (pending cleared) — both legal, signal-dependent
 *  9. OFFSET 0: pending 999999 + offset 0 → tick → "limit cancelled"
 * 10. cleanup — delete the whole test user
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
const near = (a, b, eps = 1e-7) => Math.abs(a - b) < eps;

/* 1 — register */
const email = `limit-${Date.now()}@test.local`;
const reg = await call("POST", "/api/auth/register", { email, password: "secret123", name: "L" });
check("register", reg.status === 200 || reg.status === 201);

/* 2/3 — create bots */
const mk = (sym, extra = {}) => call("PUT", "/api/bot", {
  mode: "AGGRESSIVE", symbol: sym, paper: true, enabled: false,
  orderSizeUsdt: 5, maxTradesPerDay: 4, dailyLossLimitUsdt: 20, ...extra,
});
const r1 = await mk("BTCUSDT", { entryOffsetPct: 0.5 });
check("create BTCUSDT offset 0.5 (echo)", (r1.status === 200 || r1.status === 201) && r1.json?.config?.entryOffsetPct === 0.5, `got ${r1.json?.config?.entryOffsetPct}`);
const r2 = await mk("ETHUSDT");
check("create ETHUSDT default offset 0.3", (r2.status === 200 || r2.status === 201) && r2.json?.config?.entryOffsetPct === 0.3, `got ${r2.json?.config?.entryOffsetPct}`);

/* 4 — validation */
const cur = r1.json.config;
const bad1 = await call("PUT", "/api/bot", { ...cur, entryOffsetPct: -1 });
const bad2 = await call("PUT", "/api/bot", { ...cur, entryOffsetPct: 6 });
const bad3 = await call("PUT", "/api/bot", { ...cur, entryOffsetPct: "abc" });
check("invalid offsets rejected 400", bad1.status === 400 && bad2.status === 400 && bad3.status === 400, `${bad1.status}/${bad2.status}/${bad3.status}`);
const zero = await call("PUT", "/api/bot", { ...cur, entryOffsetPct: 0 });
check("offset 0 accepted (market mode)", zero.status === 200 && zero.json?.config?.entryOffsetPct === 0);
await call("PUT", "/api/bot", { ...cur, entryOffsetPct: 0.5 }); // restore

/* 5 — pure functions (real engine module) */
const eng = await import("../src/lib/bot/engine.ts");
check("armLimitLevel 100 @0.5% = 99.5", near(eng.armLimitLevel(100, 0.5), 99.5));
check("armLimitLevel offset 0 = price", near(eng.armLimitLevel(123.45, 0), 123.45));
check("fill gap-through → open (better price)", near(eng.limitFillPrice(90, 85, 95), 90));
check("fill touch → level", near(eng.limitFillPrice(100, 95, 95), 95));
check("level always ≤ arming price (post-only)", eng.armLimitLevel(50, 0.3) < 50);

/* db handle for seeding */
const db = createClient({ url: "file:db/custom.db" });
const uid = (await db.execute({ sql: "SELECT id FROM User WHERE email = ?", args: [email] })).rows[0].id;
const cfgs = await db.execute({ sql: "SELECT id, symbol FROM BotConfig WHERE userId = ?", args: [uid] });
const bySym = Object.fromEntries(cfgs.rows.map((r) => [r.symbol, r.id]));
const now = Date.now();
async function seedPending(cfgId, level, size, ageMs) {
  await db.execute({
    sql: "UPDATE BotConfig SET pendingEntryPrice = ?, pendingEntrySize = ?, pendingEntryAt = ? WHERE id = ?",
    args: [level, size, now - ageMs, cfgId],
  });
}
async function pendingOf(cfgId) {
  const r = await db.execute({ sql: "SELECT pendingEntryPrice, pendingEntryAt FROM BotConfig WHERE id = ?", args: [cfgId] });
  return r.rows[0];
}
async function tick() {
  const res = await call("POST", "/api/bot/tick");
  const results = res.json?.results ?? [];
  return Object.fromEntries(results.map((r) => [r.symbol, r]));
}

/* 6 — FILL path: level far ABOVE market → bar low touches → fills at open */
await seedPending(bySym.BTCUSDT, 999999, 5, 5 * 60_000);
const t1 = await tick();
const btc1 = t1.BTCUSDT ?? {};
check("tick fills the armed limit (BUY)", btc1.action === "BUY" && String(btc1.reason).includes("limit fill"), `${btc1.action} · ${btc1.reason}`);
const pos = (await db.execute({ sql: "SELECT entryPrice, sizeUsdt, qty, status FROM BotPosition WHERE configId = ? AND status = 'OPEN'", args: [bySym.BTCUSDT] })).rows;
check("position OPEN size 5 below the armed level", pos.length === 1 && near(pos[0].sizeUsdt, 5) && Number(pos[0].entryPrice) > 0 && Number(pos[0].entryPrice) < 999999, JSON.stringify(pos[0]));
const pAfter = await pendingOf(bySym.BTCUSDT);
check("pending cleared after fill", pAfter.pendingEntryPrice == null);
const buyTrade = (await db.execute({ sql: "SELECT reason FROM BotTrade WHERE configId = ? AND action = 'BUY' AND status = 'PAPER' ORDER BY createdAt DESC LIMIT 1", args: [bySym.BTCUSDT] })).rows;
check("audit trail BUY 'limit fill'", buyTrade.length === 1 && String(buyTrade[0].reason).includes("limit fill"), buyTrade[0]?.reason);

/* 7 — WAITING path: level far BELOW market, young order */
await seedPending(bySym.ETHUSDT, 0.0000001, 5, 2 * 60_000);
const t2 = await tick();
const eth2 = t2.ETHUSDT ?? {};
check("young low level → waiting", eth2.action === "HOLD" && String(eth2.reason).startsWith("waiting limit"), `${eth2.action} · ${eth2.reason}`);

/* 8 — TTL path: same low level, aged 10h (TTL 3×1H) → re-arm or expire */
await db.execute({ sql: "UPDATE BotConfig SET pendingEntryAt = ? WHERE id = ?", args: [now - 10 * 3600_000, bySym.ETHUSDT] });
const t3 = await tick();
const eth3 = t3.ETHUSDT ?? {};
const reArmed = String(eth3.reason).startsWith("limit re-armed");
const expired = String(eth3.reason).startsWith("limit expired");
check("TTL hit → re-armed OR expired", eth3.action === "HOLD" && (reArmed || expired), `${eth3.action} · ${eth3.reason}`);
const p3 = await pendingOf(bySym.ETHUSDT);
if (reArmed) {
  check("re-arm refreshed level + TTL clock", Number(p3.pendingEntryPrice) > 0.0000001 && p3.pendingEntryAt != null);
} else {
  check("expiry cleared the pending", p3.pendingEntryPrice == null);
}

/* 9 — OFFSET 0 cancels a pending instead of filling it */
await call("PUT", "/api/bot", { ...(await call("GET", "/api/bot?symbol=ETHUSDT")).json.config, entryOffsetPct: 0 });
await seedPending(bySym.ETHUSDT, 999999, 5, 5 * 60_000); // far above market — must NOT fill
const t4 = await tick();
const eth4 = t4.ETHUSDT ?? {};
check("offset 0 cancels pending (no fill)", String(eth4.reason).startsWith("limit cancelled (entry offset") && eth4.action !== "BUY", `${eth4.action} · ${eth4.reason}`);
const p4 = await pendingOf(bySym.ETHUSDT);
check("pending cleared by offset-off cancel", p4.pendingEntryPrice == null);

console.log(fails.length ? `\n${fails.length} FAILURES` : "\nALL PASS");

/* 10 — cleanup */
const { PrismaClient } = await import("@prisma/client");
const p = new PrismaClient();
await p.user.delete({ where: { email } }).catch(() => {});
await p.$disconnect();
console.log("cleanup done (test user removed)");
process.exit(fails.length ? 1 : 0);
