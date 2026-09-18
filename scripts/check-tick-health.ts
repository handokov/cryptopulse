/**
 * Task 24 — tick-health snapshot (read-only) from the shared DB.
 * Answers: is the bot's automatic heartbeat alive RIGHT NOW, without the
 * user pressing "Run now"? Reads botConfig.lastTickAt per bot and prints
 * staleness in minutes (tile thresholds: green <10, amber <60, red >=60).
 * Writes NOTHING.
 */
import { db } from "../src/lib/db";

const rows = await db.botConfig.findMany({
  select: {
    symbol: true,
    enabled: true,
    paper: true,
    lastTickAt: true,
    lastPrice: true,
    updatedAt: true,
  },
  orderBy: { updatedAt: "desc" },
});

const now = Date.now();
console.log(`bots: ${rows.length}  (UTC now ${new Date().toISOString()})`);
for (const r of rows) {
  const mins = r.lastTickAt ? Math.round((now - r.lastTickAt.getTime()) / 60000) : null;
  const state =
    mins == null ? "never-ticked" : mins < 10 ? "GREEN" : mins < 60 ? "AMBER" : "RED";
  console.log(
    `${String(r.symbol).padEnd(12)} enabled=${r.enabled ? 1 : 0} paper=${r.paper ? 1 : 0}  ` +
      `lastTick=${r.lastTickAt ? r.lastTickAt.toISOString() : "never"} ` +
      `(${mins == null ? "?" : mins + " min ago"})  [${state}]  lastPrice=${r.lastPrice ?? "-"}`
  );
}
process.exit(0);
