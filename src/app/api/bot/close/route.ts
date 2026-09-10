/**
 * POST /api/bot/close — v2 phase 2 "Stop & Jual" / manual position close.
 *
 * Body: { configId }. Owner-checked; market-closes EVERY OPEN position of
 * the bot regardless of its enabled state (paper fills at the live ticker,
 * live sends a real signed market SELL). The disabling itself stays in the
 * normal config save so the UI's "Stop saja" vs "Stop & Jual" choice maps
 * to two independent, auditable actions.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { manualClosePositions } from "@/lib/bot/engine";
import { ensureBotColumns } from "@/lib/bot/migrate";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  await ensureBotColumns();

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "validation", message: "invalid JSON" }, { status: 400 });
  }

  const configId = typeof body.configId === "string" ? body.configId.trim() : "";
  if (!configId) {
    return NextResponse.json({ error: "validation", message: "configId is required" }, { status: 400 });
  }

  const cfg = await db.botConfig.findFirst({ where: { id: configId, userId: user.id } });
  if (!cfg) {
    return NextResponse.json({ error: "not_found", message: "bot not found" }, { status: 404 });
  }

  const openCount = await db.botPosition.count({ where: { configId: cfg.id, status: "OPEN" } });
  if (openCount === 0) {
    return NextResponse.json({ error: "no_position", message: "bot has no open position" }, { status: 409 });
  }

  const result = await manualClosePositions(
    { id: cfg.id, userId: cfg.userId, symbol: cfg.symbol, paper: cfg.paper },
    "manual close (stop & sell)"
  );
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, ...result, message: "one or more positions failed to close" },
      { status: 500 }
    );
  }
  return NextResponse.json({ ok: true, ...result });
}
