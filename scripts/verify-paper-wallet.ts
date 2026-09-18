/**
 * E2E verify — paper wallet (modal + equity + engine-funded entries data)
 * 1. register fresh user
 * 2. create paper bot BTCUSDT with explicit capital 20 → assert echo
 * 3. create paper bot LITUSDT without capital → assert default 20
 * 4. seed CLOSED (+0.50, −0.20) + OPEN (entry 100, size 5) via raw SQL (epoch ms!)
 * 5. GET /api/bot → assert wallet math (capital/realized/free/openSize/equity identity)
 * 6. PUT capital 50 → GET asserts; invalid capitals → 400; legacy PUT w/o field keeps value
 * 7. cleanup — delete the whole test user
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
const email = `wallet-${Date.now()}@test.local`;
const reg = await call("POST", "/api/auth/register", { email, password: "secret123", name: "W" });
check("register", reg.status === 200 || reg.status === 201);

/* 2 — bot with explicit capital */
const mk = (sym, extra = {}) => call("PUT", "/api/bot", {
  mode: "AGGRESSIVE", symbol: sym, paper: true, enabled: false,
  orderSizeUsdt: 5, maxTradesPerDay: 4, dailyLossLimitUsdt: 20, ...extra,
});
const r1 = await mk("BTCUSDT", { paperCapitalUsdt: 20 });
check("create BTCUSDT capital 20 (echo)", (r1.status === 200 || r1.status === 201) && r1.json?.config?.paperCapitalUsdt === 20, `got ${r1.json?.config?.paperCapitalUsdt}`);

/* 3 — bot without capital → default 20 */
const r2 = await mk("LITUSDT");
check("create LITUSDT default capital 20", (r2.status === 200 || r2.status === 201) && r2.json?.config?.paperCapitalUsdt === 20, `got ${r2.json?.config?.paperCapitalUsdt}`);

/* 4 — seed */
const db = createClient({ url: "file:db/custom.db" });
const uid = (await db.execute({ sql: "SELECT id FROM User WHERE email = ?", args: [email] })).rows[0].id;
const cfgs = await db.execute({ sql: "SELECT id, symbol FROM BotConfig WHERE userId = ?", args: [uid] });
const bySym = Object.fromEntries(cfgs.rows.map((r) => [r.symbol, r.id]));
const now = Date.now();
async function seedPos(cfgId, symbol, status, pnl, entry, size) {
  await db.execute({
    sql: `INSERT INTO BotPosition (id, userId, configId, symbol, side, entryPrice, qty, sizeUsdt, paper, stopPrice, targetPrice, status, exitPrice, realizedPnlUsdt, exitReason, openedAt, closedAt)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    args: [`wp${Math.random().toString(36).slice(2, 12)}`, uid, cfgId, symbol, "LONG",
      entry, size / entry, size, true, entry * 0.98, entry * 1.03, status,
      status === "CLOSED" ? entry + pnl / (size / entry) : null,
      status === "CLOSED" ? pnl : null,
      status === "CLOSED" ? "take-profit" : null,
      now - 7200e3, status === "CLOSED" ? now - 3600e3 : null],
  });
}
/* realized = +0.50 − 0.20 = +0.30 ; open 5 → free = 20 + 0.30 − 5 = 15.30 */
await seedPos(bySym.BTCUSDT, "BTCUSDT", "CLOSED", 0.50, 100, 5);
await seedPos(bySym.BTCUSDT, "BTCUSDT", "CLOSED", -0.20, 100, 5);
await seedPos(bySym.BTCUSDT, "BTCUSDT", "OPEN", null, 100, 5);

/* 5 — GET + assert wallet */
const got = await call("GET", "/api/bot?symbol=BTCUSDT");
const w = got.json?.wallet;
check("wallet present", !!w, JSON.stringify(w)?.slice(0, 200));
check("capital 20", w?.capital === 20);
check("realized +0.30", near(w?.realized ?? 9, 0.30), `got ${w?.realized}`);
check("openCount 1 openSize 5", w?.openCount === 1 && near(w?.openSize ?? 9, 5));
check("free 15.30", near(w?.free ?? 9, 15.30), `got ${w?.free}`);
check("equity identity (capital+realized+unrealized)", near(w?.equity ?? 9, 20 + 0.30 + (w?.unrealized ?? 0)), `equity ${w?.equity} unrealized ${w?.unrealized}`);
check("pnlUsdt = realized+unrealized", near(w?.pnlUsdt ?? 9, 0.30 + (w?.unrealized ?? 0)));
check("pnlPct consistent", near(w?.pnlPct ?? 9, ((w?.pnlUsdt ?? 0) / 20) * 100));
check("hasMark true (live BTC ticker)", w?.hasMark === true, `unrealized ${w?.unrealized}`);
const pos0 = got.json?.positions?.[0];
check("position carries mark + unrealized", pos0 != null && pos0.markPrice > 0 && pos0.unrealizedUsdt != null, JSON.stringify({ mark: pos0?.markPrice, u: pos0?.unrealizedUsdt }));
const pw = got.json?.portfolio?.wallet;
check("portfolio wallet capital 40 (2 paper bots x 20)", near(pw?.capitalUsdt ?? 9, 40), `got ${pw?.capitalUsdt}`);
check("portfolio wallet equity identity", near(pw?.equityUsdt ?? 9, pw?.capitalUsdt + 0.30 + (w?.unrealized ?? 0)), `got ${pw?.equityUsdt}`);

/* 6 — update / validation / legacy-compat */
const put = (body) => call("PUT", "/api/bot", body);
const cur = got.json?.config;
const up = await put({ ...cur, paperCapitalUsdt: 50 });
check("update capital 50", up.status === 200 && up.json?.config?.paperCapitalUsdt === 50);
const got2 = await call("GET", "/api/bot?symbol=BTCUSDT");
check("wallet now capital 50 free 45.30", got2.json?.wallet?.capital === 50 && near(got2.json?.wallet?.free ?? 9, 45.30), `got ${got2.json?.wallet?.capital}/${got2.json?.wallet?.free}`);
const bad1 = await put({ ...cur, paperCapitalUsdt: 0 });
const bad2 = await put({ ...cur, paperCapitalUsdt: 200000 });
const bad3 = await put({ ...cur, paperCapitalUsdt: "abc" });
check("invalid capitals rejected 400", bad1.status === 400 && bad2.status === 400 && bad3.status === 400, `${bad1.status}/${bad2.status}/${bad3.status}`);
const legacy = { ...cur, paperCapitalUsdt: undefined, id: cur.id };
delete legacy.paperCapitalUsdt;
const leg = await put(legacy);
check("legacy PUT without field keeps 50", leg.status === 200 && leg.json?.config?.paperCapitalUsdt === 50, `got ${leg.json?.config?.paperCapitalUsdt}`);

console.log(fails.length ? `\n${fails.length} FAILURES` : "\nALL PASS");

/* 7 — cleanup */
const { PrismaClient } = await import("@prisma/client");
const p = new PrismaClient();
await p.user.delete({ where: { email } }).catch(() => {});
await p.$disconnect();
console.log("cleanup done (test user removed)");
process.exit(fails.length ? 1 : 0);
