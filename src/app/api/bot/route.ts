/**
 * GET  /api/bot — the signed-in user's bot: config (or defaults), open
 *                 positions, last 25 trades, today's summary.
 * PUT  /api/bot — upsert the single BotConfig. Validation is strict:
 *                 mode preset, symbol shape, size ≥ 1.5 USDT (user floor),
 *                 sane trade/loss caps. Going LIVE requires confirmLive:true.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { MODE_PRESETS, type BotMode } from "@/lib/bot/strategy";

export const dynamic = "force-dynamic";

const SYMBOL_RE = /^[A-Z0-9]{2,10}USDT$/;

function defaults(userId: string) {
  return {
    userId,
    mode: "MODERATE" as BotMode,
    symbol: "BTCUSDT",
    paper: true,
    enabled: false,
    orderSizeUsdt: 5,
    maxTradesPerDay: MODE_PRESETS.MODERATE.maxTradesPerDay,
    dailyLossLimitUsdt: 20,
  };
}

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const config = (await db.botConfig.findUnique({ where: { userId: user.id } })) ?? null;
  const configId = config?.id ?? "";
  const [positions, trades] = await Promise.all([
    configId
      ? db.botPosition.findMany({ where: { configId, status: "OPEN" }, orderBy: { openedAt: "desc" }, take: 10 })
      : Promise.resolve([]),
    configId
      ? db.botTrade.findMany({ where: { configId }, orderBy: { createdAt: "desc" }, take: 25 })
      : Promise.resolve([]),
  ]);

  const dayStart = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
  const todayTrades = configId
    ? await db.botTrade.findMany({
        where: { configId, createdAt: { gte: dayStart }, action: { in: ["BUY", "SELL"] }, status: { in: ["PAPER", "SUBMITTED"] } },
      })
    : [];
  const paperFlag = config?.paper ?? true;
  const relevant = todayTrades.filter((t) => t.paper === paperFlag);
  const summary = {
    tradesToday: relevant.length,
    realizedTodayUsdt: relevant.reduce((acc, t) => acc + (t.pnlUsdt ?? 0), 0),
    maxTradesPerDay: config ? MODE_PRESETS[(config.mode as BotMode) in MODE_PRESETS ? (config.mode as BotMode) : "MODERATE"].maxTradesPerDay : null,
    presets: MODE_PRESETS,
  };

  return NextResponse.json({ config: config ?? { ...defaults(user.id), id: null }, positions, trades, summary });
}

export async function PUT(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "validation", message: "invalid JSON" }, { status: 400 });
  }

  const mode = String(body.mode ?? "");
  if (mode !== "MODERATE" && mode !== "AGGRESSIVE") {
    return NextResponse.json({ error: "validation", message: "mode must be MODERATE or AGGRESSIVE" }, { status: 400 });
  }
  const symbol = String(body.symbol ?? "").toUpperCase();
  if (!SYMBOL_RE.test(symbol)) {
    return NextResponse.json({ error: "validation", message: "symbol must look like BTCUSDT" }, { status: 400 });
  }
  const orderSizeUsdt = Number(body.orderSizeUsdt);
  if (!Number.isFinite(orderSizeUsdt) || orderSizeUsdt < 1.5 || orderSizeUsdt > 1000) {
    return NextResponse.json({ error: "validation", message: "order size must be between 1.5 and 1000 USDT" }, { status: 400 });
  }
  const maxTradesPerDay = Number(body.maxTradesPerDay);
  if (!Number.isInteger(maxTradesPerDay) || maxTradesPerDay < 1 || maxTradesPerDay > 20) {
    return NextResponse.json({ error: "validation", message: "max trades per day must be 1..20" }, { status: 400 });
  }
  const dailyLossLimitUsdt = Number(body.dailyLossLimitUsdt);
  if (!Number.isFinite(dailyLossLimitUsdt) || dailyLossLimitUsdt < 1 || dailyLossLimitUsdt > 10000) {
    return NextResponse.json({ error: "validation", message: "daily loss limit must be 1..10000 USDT" }, { status: 400 });
  }
  const paper = Boolean(body.paper);
  const enabled = Boolean(body.enabled);
  const confirmLive = Boolean(body.confirmLive);

  if (!paper && enabled && !confirmLive) {
    return NextResponse.json(
      { error: "confirm_live", message: "enabling a LIVE bot requires explicit confirmation" },
      { status: 400 }
    );
  }

  const config = await db.botConfig.upsert({
    where: { userId: user.id },
    update: { mode, symbol, paper, enabled, orderSizeUsdt, maxTradesPerDay, dailyLossLimitUsdt },
    create: { userId: user.id, mode, symbol, paper, enabled, orderSizeUsdt, maxTradesPerDay, dailyLossLimitUsdt },
  });

  return NextResponse.json({ ok: true, config });
}
