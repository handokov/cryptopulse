/**
 * One-time additive migration for the VOL exit style (Task 23).
 *
 * Production Turso tables were created by scripts (CREATE IF NOT EXISTS +
 * explicit ALTERs), so a fresh deploy must add the two new columns before
 * the engine can read/write them:
 *   BotConfig.exitStyle     TEXT    NOT NULL DEFAULT 'FIXED'
 *   BotPosition.highestPrice REAL   (nullable)
 *
 * Idempotent: each ALTER only runs when a probe SELECT fails. The result is
 * memoized per process (serverless instances stay warm between ticks), so
 * the cost after the first call is one settled promise.
 *
 * Called from the bot routes before any engine/db access that touches the
 * new columns. Failures are logged and swallowed — the tick will surface a
 * per-bot ERROR instead of crashing the whole batch.
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
  return ok;
}

/** Resolves true when both columns are present (or were just added). */
export function ensureBotColumns(): Promise<boolean> {
  if (!migration) {
    migration = run().then((ok) => {
      if (!ok) migration = null; // allow a retry on the next tick
      return ok;
    });
  }
  return migration;
}
