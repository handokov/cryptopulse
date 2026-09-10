/**
 * Runtime schema migrations for the production Turso database.
 *
 * The Prisma 6 sqlite connector only speaks file: URLs, so `prisma db push`
 * cannot reach libsql:// endpoints. Instead the bot routes call
 * `ensureBotColumns()` before touching the new columns, and each migration
 * step here is idempotent + memoized per process (serverless instances stay
 * warm between ticks).
 *
 * Steps:
 *   1. VOL exit style (Task 23) — additive columns:
 *        BotConfig.exitStyle     TEXT NOT NULL DEFAULT 'FIXED'
 *        BotPosition.highestPrice REAL (nullable)
 *   2. Multi-bot (Task 30) — BotConfig userId UNIQUE → UNIQUE(userId, symbol).
 *      The old inline UNIQUE(userId) created an auto-index that SQLite cannot
 *      drop, so the table must be REBUILT. The rebuild is atomic and FK-safe:
 *      child rows (BotPosition/BotTrade) are moved to plain backup tables and
 *      restored inside the same interactive transaction, so the implicit
 *      DELETE that DROP TABLE performs under foreign_keys=ON can never
 *      cascade into the trade history. Any failure rolls back everything.
 *   3. v2 phase 2 (Task 31) — additive columns, no rebuild:
 *        BotConfig.timeframe TEXT NOT NULL DEFAULT '4H'
 *        BotConfig.entryLine REAL (nullable)
 *        BotConfig.lastPrice REAL (nullable)
 *
 * Failures are logged and swallowed — the tick surfaces a per-bot ERROR
 * instead of crashing the batch, and the memo reset retries on the next call.
 */

import { db } from "@/lib/db";

let migration: Promise<boolean> | null = null;

async function columnExists(table: string, column: string): Promise<boolean> {
  try {
    await db.$queryRawUnsafe(`SELECT "${column}" FROM "${table}" LIMIT 1`);
    return true;
  } catch {
    return false;
  }
}

/** True when a UNIQUE index on exactly (userId, symbol) exists on BotConfig. */
async function multiBotIndexReady(): Promise<boolean> {
  const tables = await db.$queryRawUnsafe<{ name: string }[]>(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'BotConfig'`
  );
  if (!tables || tables.length === 0) return true; // fresh DB — DDL script creates the new shape

  const indexes = await db.$queryRawUnsafe<{ name: string; unique: number | bigint }[]>(
    `PRAGMA index_list('BotConfig')`
  );
  for (const idx of indexes ?? []) {
    if (Number(idx.unique) !== 1) continue;
    const cols = await db.$queryRawUnsafe<{ name: string | null }[]>(
      `PRAGMA index_info("${idx.name}")`
    );
    const names = (cols ?? [])
      .map((c) => String(c.name))
      .filter((n) => n && n !== "null")
      .sort()
      .join(",");
    if (names === "symbol,userId") return true;
  }
  return false;
}

/**
 * Atomic, FK-safe rebuild of BotConfig: UNIQUE(userId) → UNIQUE(userId, symbol).
 * Child rows are stashed in constraint-free backup tables and restored in the
 * same transaction — with the children empty, DROP TABLE's implicit DELETE has
 * nothing to cascade into. Config ids are preserved, so the restored
 * BotPosition.configId / BotTrade.configId foreign keys stay valid.
 */
async function rebuildBotConfigForMultiBot(): Promise<void> {
  await db.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(`DROP TABLE IF EXISTS "BotConfig_new"`);
      await tx.$executeRawUnsafe(`
        CREATE TABLE "BotConfig_new" (
          "id" TEXT NOT NULL PRIMARY KEY,
          "userId" TEXT NOT NULL,
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
        )
      `);
      await tx.$executeRawUnsafe(`
        INSERT INTO "BotConfig_new"
          ("id","userId","mode","symbol","paper","enabled","orderSizeUsdt","maxTradesPerDay",
           "dailyLossLimitUsdt","takeProfitPct","stopLossPct","exitStyle","lastTickAt","createdAt","updatedAt")
        SELECT
          "id","userId","mode","symbol","paper","enabled","orderSizeUsdt","maxTradesPerDay",
          "dailyLossLimitUsdt","takeProfitPct","stopLossPct","exitStyle","lastTickAt","createdAt","updatedAt"
        FROM "BotConfig"
      `);
      /* Stash children in plain (constraint-free) tables, then empty them so
         dropping the parent cannot cascade. */
      await tx.$executeRawUnsafe(`DROP TABLE IF EXISTS "BotPosition_mbot_bak"`);
      await tx.$executeRawUnsafe(`DROP TABLE IF EXISTS "BotTrade_mbot_bak"`);
      await tx.$executeRawUnsafe(`CREATE TABLE "BotPosition_mbot_bak" AS SELECT * FROM "BotPosition"`);
      await tx.$executeRawUnsafe(`CREATE TABLE "BotTrade_mbot_bak" AS SELECT * FROM "BotTrade"`);
      await tx.$executeRawUnsafe(`DELETE FROM "BotPosition"`);
      await tx.$executeRawUnsafe(`DELETE FROM "BotTrade"`);
      /* Swap the parent. */
      await tx.$executeRawUnsafe(`DROP TABLE "BotConfig"`);
      await tx.$executeRawUnsafe(`ALTER TABLE "BotConfig_new" RENAME TO "BotConfig"`);
      await tx.$executeRawUnsafe(
        `CREATE UNIQUE INDEX "BotConfig_userId_symbol_key" ON "BotConfig"("userId", "symbol")`
      );
      /* Restore children (ids unchanged → FKs valid against the new parent). */
      await tx.$executeRawUnsafe(`INSERT INTO "BotPosition" SELECT * FROM "BotPosition_mbot_bak"`);
      await tx.$executeRawUnsafe(`INSERT INTO "BotTrade" SELECT * FROM "BotTrade_mbot_bak"`);
      await tx.$executeRawUnsafe(`DROP TABLE "BotPosition_mbot_bak"`);
      await tx.$executeRawUnsafe(`DROP TABLE "BotTrade_mbot_bak"`);
    },
    { maxWait: 10_000, timeout: 30_000 }
  );
}

async function run(): Promise<boolean> {
  let ok = true;
  try {
    if (!(await columnExists("BotConfig", "exitStyle"))) {
      await db.$executeRawUnsafe(`ALTER TABLE "BotConfig" ADD COLUMN "exitStyle" TEXT NOT NULL DEFAULT 'FIXED'`);
      console.log("[bot-migrate] BotConfig.exitStyle added");
    }
  } catch (err) {
    ok = false;
    console.error("[bot-migrate] BotConfig.exitStyle failed:", err instanceof Error ? err.message : err);
  }
  try {
    if (!(await columnExists("BotPosition", "highestPrice"))) {
      await db.$executeRawUnsafe(`ALTER TABLE "BotPosition" ADD COLUMN "highestPrice" REAL`);
      console.log("[bot-migrate] BotPosition.highestPrice added");
    }
  } catch (err) {
    ok = false;
    console.error("[bot-migrate] BotPosition.highestPrice failed:", err instanceof Error ? err.message : err);
  }
  /* v2 phase 2 — timeframe + entry line + last price (plain additive columns). */
  try {
    if (!(await columnExists("BotConfig", "timeframe"))) {
      await db.$executeRawUnsafe(`ALTER TABLE "BotConfig" ADD COLUMN "timeframe" TEXT NOT NULL DEFAULT '4H'`);
      console.log("[bot-migrate] BotConfig.timeframe added");
    }
  } catch (err) {
    ok = false;
    console.error("[bot-migrate] BotConfig.timeframe failed:", err instanceof Error ? err.message : err);
  }
  try {
    if (!(await columnExists("BotConfig", "entryLine"))) {
      await db.$executeRawUnsafe(`ALTER TABLE "BotConfig" ADD COLUMN "entryLine" REAL`);
      console.log("[bot-migrate] BotConfig.entryLine added");
    }
  } catch (err) {
    ok = false;
    console.error("[bot-migrate] BotConfig.entryLine failed:", err instanceof Error ? err.message : err);
  }
  try {
    if (!(await columnExists("BotConfig", "lastPrice"))) {
      await db.$executeRawUnsafe(`ALTER TABLE "BotConfig" ADD COLUMN "lastPrice" REAL`);
      console.log("[bot-migrate] BotConfig.lastPrice added");
    }
  } catch (err) {
    ok = false;
    console.error("[bot-migrate] BotConfig.lastPrice failed:", err instanceof Error ? err.message : err);
  }
  /* Multi-bot: swap UNIQUE(userId) for UNIQUE(userId, symbol). */
  try {
    if (!(await multiBotIndexReady())) {
      await rebuildBotConfigForMultiBot();
      console.log("[bot-migrate] BotConfig rebuilt for multi-bot UNIQUE(userId, symbol)");
    }
  } catch (err) {
    ok = false;
    console.error("[bot-migrate] multi-bot rebuild failed:", err instanceof Error ? err.message : err);
  }
  return ok;
}

/** Resolves true when all migrations are present (or were just applied). */
export function ensureBotColumns(): Promise<boolean> {
  if (!migration) {
    migration = run().then((ok) => {
      if (!ok) migration = null; // allow a retry on the next tick
      return ok;
    });
  }
  return migration;
}
