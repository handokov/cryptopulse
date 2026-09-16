/**
 * POST /api/bot/tick — run the bot decision loop once.
 *
 * Three callers:
 *   1. A signed-in user pressing "Run now" (session cookie) — runs ALL their
 *      bots and bypasses the 4-minute cron guard (manual = explicit).
 *   2. The page heartbeat (`?mode=heartbeat`, session cookie) — GUARDED runs
 *      for "enabled OR has-open-position" bots while the dashboard is open;
 *      free-tier GitHub cron degrades to 2-7 h gaps, so the open page is the
 *      real-time guardian of TP/SL exits.
 *   3. A scheduled cron (GitHub Actions every 5 min nominal) sending
 *      `x-bot-secret: $BOT_TICK_SECRET` — runs the same guardian set. The
 *      secret lives in Vercel env; when unset, the cron path answers 404 so
 *      the endpoint can't be abused.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { runBotTicks } from "@/lib/bot/engine";
import { ensureBotColumns } from "@/lib/bot/migrate";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  await ensureBotColumns();

  const mode = new URL(req.url).searchParams.get("mode");
  const secret = process.env.BOT_TICK_SECRET;
  const provided = req.headers.get("x-bot-secret");

  if (secret && provided && provided === secret) {
    const results = await runBotTicks({ force: false });
    return NextResponse.json({ ok: true, mode: "cron", ranAt: new Date().toISOString(), results });
  }

  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: secret ? 401 : 404 });

  /* Heartbeat = guarded (respects the 4-min min gap, exits always evaluated,
     entries only for enabled bots). Default stays the explicit manual run. */
  const heartbeat = mode === "heartbeat";
  const results = await runBotTicks({ userId: user.id, force: !heartbeat });
  return NextResponse.json({
    ok: true,
    mode: heartbeat ? "heartbeat" : "manual",
    ranAt: new Date().toISOString(),
    results,
  });
}
