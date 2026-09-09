/**
 * POST /api/bot/tick — run the bot decision loop once.
 *
 * Two callers:
 *   1. A signed-in user pressing "Run now" (session cookie) — runs ONLY their
 *      bot and bypasses the 4-minute cron guard (manual = explicit).
 *   2. A scheduled cron (GitHub Actions every 5 min) sending
 *      `x-bot-secret: $BOT_TICK_SECRET` — runs ALL enabled bots with the
 *      guard active. The secret lives in Vercel env; when unset, the cron
 *      path answers 404 so the endpoint can't be abused.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { runBotTicks } from "@/lib/bot/engine";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const secret = process.env.BOT_TICK_SECRET;
  const provided = req.headers.get("x-bot-secret");

  if (secret && provided && provided === secret) {
    const results = await runBotTicks({ force: false });
    return NextResponse.json({ ok: true, mode: "cron", ranAt: new Date().toISOString(), results });
  }

  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: secret ? 401 : 404 });

  const results = await runBotTicks({ userId: user.id, force: true });
  return NextResponse.json({ ok: true, mode: "manual", ranAt: new Date().toISOString(), results });
}
