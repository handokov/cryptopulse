/**
 * E2E verify — portfolio aggregate (total P/L across ALL bots)
 * 1. register fresh user
 * 2. create 3 paper bots: BTCUSDT, LITUSDT, HYPEUSDT
 * 3. seed synthetic CLOSED positions + today/yesterday SELL trades via libsql
 * 4. GET /api/bot → assert portfolio aggregate (today, all-time, per-bot, sorting)
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
const email = `pf-${Date.now()}@test.local`;
const reg = await call("POST", "/api/auth/register", { email, password: "secret123", name: "PF" });
check("register", reg.status === 200 || reg.status === 201);

/* 2 — create 3 bots */
for (const sym of ["BTCUSDT", "LITUSDT", "HYPEUSDT"]) {
  const r = await call("PUT", "/api/bot", {
    mode: "AGGRESSIVE", symbol: sym, paper: true, enabled: false,
    orderSizeUsdt: 5, maxTradesPerDay: 4, dailyLossLimitUsdt: 20,
  });
  check(`create ${sym}`, r.status === 200 || r.status === 201);
}

/* 3 — seed synthetic data */
const db = createClient({ url: "file:db/custom.db" });
const uid = (await db.execute({ sql: "SELECT id FROM User WHERE email = ?", args: [email] })).rows[0].id;
const cfgs = await db.execute({ sql: "SELECT id, symbol FROM BotConfig WHERE userId = ?", args: [uid] });
const bySym = Object.fromEntries(cfgs.rows.map((r) => [r.symbol, r.id]));
check("3 configs in DB", cfgs.rows.length === 3);

const now = Date.now();
/* Prisma stores SQLite DateTime as INTEGER epoch ms — raw seeds must match, or
   date comparisons degrade to SQLite type-ordering (number < text) and lie. */
async function seedPos(cfgId, symbol, pnl, closedAgoMs, reason) {
  await db.execute({
    sql: `INSERT INTO BotPosition (id, userId, configId, symbol, side, entryPrice, qty, sizeUsdt, paper, stopPrice, targetPrice, status, exitPrice, realizedPnlUsdt, exitReason, openedAt, closedAt)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    args: [`pf${Math.random().toString(36).slice(2, 12)}`, uid, cfgId, symbol, "LONG",
      100, 0.05, 5, true, 98, 103, "CLOSED", 100 + pnl / 0.05, pnl, reason,
      now - closedAgoMs - 3600e3, now - closedAgoMs],
  });
}
async function seedSell(cfgId, symbol, pnl, atMs) {
  await db.execute({
    sql: `INSERT INTO BotTrade (id, userId, configId, symbol, action, paper, sizeUsdt, qty, price, status, reason, pnlUsdt, createdAt)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    args: [`pf${Math.random().toString(36).slice(2, 12)}`, uid, cfgId, symbol, "SELL", true,
      5, 0.05, 100, "PAPER", "seed", pnl, atMs],
  });
}
/* all-time: BTC +2.60 +1.10 | LIT -1.80 | HYPE +0.55  → total +2.45 */
await seedPos(bySym.BTCUSDT, "BTCUSDT", 2.60, 3 * 86400e3, "take-profit");
await seedPos(bySym.BTCUSDT, "BTCUSDT", 1.10, 2 * 86400e3, "trail-stop");
await seedPos(bySym.LITUSDT, "LITUSDT", -1.80, 2 * 86400e3, "stop-loss");
await seedPos(bySym.HYPEUSDT, "HYPEUSDT", 0.55, 86400e3, "take-profit");
/* today: BTC +0.85, LIT -0.42 → today +0.43 ; yesterday BTC -0.20 (must NOT count) */
await seedSell(bySym.BTCUSDT, "BTCUSDT", 0.85, now - 2 * 3600e3);
await seedSell(bySym.LITUSDT, "LITUSDT", -0.42, now - 1 * 3600e3);
await seedSell(bySym.BTCUSDT, "BTCUSDT", -0.20, now - 30 * 3600e3);

/* 4 — GET and assert */
const got = await call("GET", "/api/bot?symbol=BTCUSDT");
const pf = got.json?.portfolio;
check("portfolio present", !!pf, JSON.stringify(pf)?.slice(0, 160));
check("bots count 3", pf?.bots === 3);
check("total +2.45", Math.abs(pf?.totalUsdt - 2.45) < 1e-9, `got ${pf?.totalUsdt}`);
check("today +0.43", Math.abs(pf?.todayUsdt - 0.43) < 1e-9, `got ${pf?.todayUsdt}`);
check("closedCount 4", pf?.closedCount === 4);
check("todayCount 2 (yesterday excluded)", pf?.todayCount === 2);
const pb = Object.fromEntries((pf?.perBot ?? []).map((r) => [r.symbol, r]));
check("perBot BTC total 3.70 today 0.85", Math.abs(pb.BTCUSDT?.totalUsdt - 3.70) < 1e-9 && Math.abs(pb.BTCUSDT?.todayUsdt - 0.85) < 1e-9);
check("perBot sorted desc by total", (pf?.perBot ?? []).map((r) => r.symbol).join(",") === "BTCUSDT,HYPEUSDT,LITUSDT", (pf?.perBot ?? []).map((r) => r.symbol).join(","));

console.log(fails.length ? `\n${fails.length} FAILURES` : "\nALL PASS");

/* cleanup — remove the whole test user (cascades configs/positions/trades) + probe row */
const { PrismaClient } = await import("@prisma/client");
const p = new PrismaClient();
await p.user.delete({ where: { email } }).catch(() => {});
await p.botTrade.deleteMany({ where: { reason: "format-probe" } });
await p.$disconnect();
console.log("cleanup done (test user removed)");
process.exit(fails.length ? 1 : 0);
