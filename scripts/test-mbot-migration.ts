/**
 * Dry-run the multi-bot BotConfig rebuild against a synthetic OLD-shape
 * SQLite database (UNIQUE(userId) + children with FK cascades), exactly like
 * production Turso. Verifies: config rows survive, positions/trades survive,
 * the new UNIQUE(userId, symbol) index exists, and a second bot per user can
 * be inserted afterwards.
 *
 * Run: bun scripts/test-mbot-migration.ts
 */
import { rmSync } from "node:fs";

const DB = "/home/z/my-project/db/test-mbot.db";
try { rmSync(DB); } catch { /* fresh */ }

process.env.DATABASE_URL = `file:${DB}`;

const { createClient } = await import("@libsql/client");
const seed = createClient({ url: `file:${DB}` });

await seed.executeMultiple(`
  CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "passwordHash" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
  );
  CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
  CREATE TABLE "BotConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL UNIQUE,
    "mode" TEXT NOT NULL DEFAULT 'MODERATE',
    "symbol" TEXT NOT NULL DEFAULT 'BTCUSDT',
    "paper" BOOLEAN NOT NULL DEFAULT true,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "orderSizeUsdt" REAL NOT NULL DEFAULT 5,
    "maxTradesPerDay" INTEGER NOT NULL DEFAULT 4,
    "dailyLossLimitUsdt" REAL NOT NULL DEFAULT 20,
    "takeProfitPct" REAL,
    "stopLossPct" REAL,
    "exitStyle" TEXT NOT NULL DEFAULT 'FIXED',
    "lastTickAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BotConfig_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  );
  CREATE TABLE "BotPosition" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "configId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "side" TEXT NOT NULL DEFAULT 'LONG',
    "entryPrice" REAL NOT NULL,
    "qty" REAL NOT NULL,
    "sizeUsdt" REAL NOT NULL,
    "paper" BOOLEAN NOT NULL DEFAULT true,
    "stopPrice" REAL NOT NULL,
    "targetPrice" REAL NOT NULL,
    "highestPrice" REAL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "exitPrice" REAL,
    "realizedPnlUsdt" REAL,
    "exitReason" TEXT,
    "openedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" DATETIME,
    CONSTRAINT "BotPosition_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BotPosition_configId_fkey" FOREIGN KEY ("configId") REFERENCES "BotConfig" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  );
  CREATE TABLE "BotTrade" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "configId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "paper" BOOLEAN NOT NULL DEFAULT true,
    "sizeUsdt" REAL,
    "qty" REAL,
    "price" REAL,
    "orderId" TEXT,
    "clientOid" TEXT,
    "status" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "detail" TEXT,
    "pnlUsdt" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BotTrade_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BotTrade_configId_fkey" FOREIGN KEY ("configId") REFERENCES "BotConfig" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  );
  INSERT INTO "User" ("id","email","passwordHash","createdAt","updatedAt") VALUES ('u1','test@example.com','x','2026-09-08 00:00:00','2026-09-08 00:00:00');
  INSERT INTO "BotConfig" ("id","userId","symbol","enabled","exitStyle","createdAt","updatedAt")
    VALUES ('c1','u1','LITUSDT',1,'VOL','2026-09-08 00:00:00','2026-09-08 00:00:00');
  INSERT INTO "BotPosition" ("id","userId","configId","symbol","entryPrice","qty","sizeUsdt","stopPrice","targetPrice","status","realizedPnlUsdt","exitReason","openedAt","closedAt")
    VALUES ('p1','u1','c1','LITUSDT',5.296,0.944,5.0,5.23245,5.39136,'CLOSED',-0.061,'stop-loss: price crossed stop','2026-09-09 07:51:00','2026-09-09 08:35:00'),
           ('p2','u1','c1','LITUSDT',5.227,0.956,5.0,5.16428,5.32116,'CLOSED',-0.067,'stop-loss: price crossed stop','2026-09-09 09:25:00','2026-09-09 09:50:00');
  INSERT INTO "BotTrade" ("id","userId","configId","symbol","action","sizeUsdt","qty","price","status","reason","pnlUsdt","createdAt")
    VALUES ('t1','u1','c1','LITUSDT','BUY',5.0,0.944,5.296,'PAPER','score 0.81 ≥ entry 0.55',NULL,'2026-09-09 07:51:00'),
           ('t2','u1','c1','LITUSDT','SELL',5.0,0.944,5.231,'PAPER','stop-loss',-0.061,'2026-09-09 08:35:00'),
           ('t3','u1','c1','LITUSDT','BUY',5.0,0.956,5.227,'PAPER','score 0.80 ≥ entry 0.55',NULL,'2026-09-09 09:25:00');
`);
await seed.close();

/* Run the migration through the app's own Prisma client (plain sqlite mode). */
const { ensureBotColumns } = await import("../src/lib/bot/migrate");
const ok = await ensureBotColumns();
console.log("ensureBotColumns →", ok);

const v = createClient({ url: `file:${DB}` });
const q = async (sql: string) => (await v.execute(sql)).rows;

const cfg = await q(`SELECT id, userId, symbol, exitStyle FROM "BotConfig"`);
const pos = await q(`SELECT COUNT(*) AS n FROM "BotPosition"`);
const trd = await q(`SELECT COUNT(*) AS n FROM "BotTrade"`);
const pnl = await q(`SELECT SUM(realizedPnlUsdt) AS s FROM "BotPosition"`);
const idx = await q(`PRAGMA index_list('BotConfig')`);
let pairIdx = "MISSING";
for (const row of idx) {
  const name = String(row.name);
  const unique = Number(row.unique) === 1;
  const cols = await q(`PRAGMA index_info("${name}")`);
  const names = cols.map((c) => String(c.name)).sort().join(",");
  if (unique && names === "symbol,userId") pairIdx = name;
}
console.log("configs after:", JSON.stringify(cfg));
console.log("positions:", pos[0].n, "trades:", trd[0].n, "pnl sum:", pnl[0].s);
console.log("unique(userId,symbol) index:", pairIdx);

/* Prove multi-bot works now: second config, same user, different symbol. */
try {
  await v.execute(`INSERT INTO "BotConfig" ("id","userId","symbol","createdAt","updatedAt") VALUES ('c2','u1','BTCUSDT','2026-09-10 00:00:00','2026-09-10 00:00:00')`);
  console.log("second bot insert: OK");
} catch (e) {
  console.log("second bot insert FAILED:", e instanceof Error ? e.message : e);
}
/* Prove the pair-uniqueness holds: same user+symbol must fail. */
try {
  await v.execute(`INSERT INTO "BotConfig" ("id","userId","symbol","createdAt","updatedAt") VALUES ('c3','u1','LITUSDT','2026-09-10 00:00:00','2026-09-10 00:00:00')`);
  console.log("duplicate pair insert: UNEXPECTEDLY OK (BUG)");
} catch {
  console.log("duplicate pair insert: correctly rejected");
}
await v.close();
