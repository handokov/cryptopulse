/**
 * Multi-bot API (v2) — one bot per (user, symbol); quotas: 5 paper + 2 live.
 *
 * GET    /api/bot?symbol=LITUSDT — the user's bot LIST (`bots`) + quota usage,
 *        plus the ACTIVE bot's detail (config, open positions, last 25 trades,
 *        today's summary, all-time stats). `?symbol` picks the active bot;
 *        omitted/unknown falls back to the first bot (ascending creation).
 * PUT    /api/bot — create or update. With `id` → update that bot (symbol
 *        rename allowed when the pair is free). Without `id` → upsert by
 *        (userId, symbol): existing pair updates, new pair creates (quota
 *        enforced). Validation identical to v1; LIVE enable needs confirmLive.
 * DELETE /api/bot?id=… — remove a bot. Blocked while it has an OPEN position
 *        (stop ≠ sell: the bot manages its exits, deleting would orphan them).
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { MODE_PRESETS, type BotMode } from "@/lib/bot/strategy";
import { ensureBotColumns } from "@/lib/bot/migrate";

export const dynamic = "force-dynamic";

const SYMBOL_RE = /^[A-Z0-9]{2,10}USDT$/;
const MAX_PAPER_BOTS = 5;
const MAX_LIVE_BOTS = 2;

function defaults(userId: string, symbol: string) {
  return {
    userId,
    mode: "MODERATE" as BotMode,
    symbol,
    paper: true,
    enabled: false,
    orderSizeUsdt: 5,
    maxTradesPerDay: MODE_PRESETS.MODERATE.maxTradesPerDay,
    dailyLossLimitUsdt: 20,
    exitStyle: "FIXED" as const,
  };
}

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  await ensureBotColumns();

  const wantSymbol = (new URL(req.url).searchParams.get("symbol") ?? "").toUpperCase();
  const configs = await db.botConfig.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" } });
  const config = configs.find((c) => c.symbol === wantSymbol) ?? configs[0] ?? null;
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

  /* ---- performance stats (all-time, for the current paper/live mode) ---- */
  const closed = configId
    ? await db.botPosition.findMany({ where: { configId, status: "CLOSED", paper: paperFlag }, orderBy: { closedAt: "asc" } })
    : [];
  const pnls = closed.map((p) => p.realizedPnlUsdt ?? 0);
  const wins = pnls.filter((p) => p > 0);
  const losses = pnls.filter((p) => p < 0);
  const exitCounts: Record<string, number> = {};
  for (const p of closed) {
    const key = p.exitReason?.startsWith("take-profit")
      ? "take-profit"
      : p.exitReason?.startsWith("trail-stop")
        ? "trail-stop"
        : p.exitReason?.startsWith("stop-loss")
          ? "stop-loss"
          : p.exitReason?.startsWith("signal")
            ? "signal-flip"
            : "other";
    exitCounts[key] = (exitCounts[key] ?? 0) + 1;
  }
  /* per-UTC-day realized PnL, last 14 days (cumulative curve built client-side) */
  const dailyPnl: { day: string; pnl: number }[] = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
    dailyPnl.push({ day: d, pnl: 0 });
  }
  const dayIndex = new Map(dailyPnl.map((r, i) => [r.day, i]));
  for (const p of closed) {
    if (!p.closedAt) continue;
    const key = p.closedAt.toISOString().slice(0, 10);
    const idx = dayIndex.get(key);
    if (idx !== undefined) dailyPnl[idx].pnl += p.realizedPnlUsdt ?? 0;
  }
  const winRate = closed.length ? wins.length / closed.length : null;
  const avgWin = wins.length ? wins.reduce((a, b) => a + b, 0) / wins.length : null;
  const avgLoss = losses.length ? losses.reduce((a, b) => a + b, 0) / losses.length : null;
  const stats = {
    closedCount: closed.length,
    winCount: wins.length,
    lossCount: losses.length,
    winRate,
    totalPnlUsdt: pnls.reduce((a, b) => a + b, 0),
    avgWinUsdt: avgWin,
    avgLossUsdt: avgLoss,
    bestUsdt: closed.length ? Math.max(...pnls) : null,
    worstUsdt: closed.length ? Math.min(...pnls) : null,
    /* expectancy: average PnL per closed trade */
    expectancyUsdt: closed.length ? pnls.reduce((a, b) => a + b, 0) / closed.length : null,
    exitCounts,
    dailyPnl,
  };

  /* multi-bot payload: light list + quota usage */
  const bots = configs.map((c) => ({
    id: c.id,
    symbol: c.symbol,
    mode: c.mode as BotMode,
    paper: c.paper,
    enabled: c.enabled,
    exitStyle: c.exitStyle ?? "FIXED",
    orderSizeUsdt: c.orderSizeUsdt,
  }));
  const quota = {
    paper: configs.filter((c) => c.paper).length,
    live: configs.filter((c) => !c.paper).length,
    maxPaper: MAX_PAPER_BOTS,
    maxLive: MAX_LIVE_BOTS,
  };

  return NextResponse.json({
    config: config ?? { ...defaults(user.id, wantSymbol || "BTCUSDT"), id: null },
    bots,
    quota,
    positions,
    trades,
    summary,
    stats,
  });
}

export async function PUT(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  await ensureBotColumns();

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

  /* Optional exit-ladder overrides. null/empty/undefined = use the mode preset. */
  const toPctOrNull = (v: unknown, min: number, max: number) => {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    if (!Number.isFinite(n)) return { err: "not a number" as const };
    if (n < min || n > max) return { err: `must be ${min}..${max}` as const };
    return { n };
  };
  const tp = toPctOrNull(body.takeProfitPct, 0.3, 50);
  if (tp && "err" in tp) {
    return NextResponse.json({ error: "validation", message: `take-profit ${tp.err} (%)` }, { status: 400 });
  }
  const sl = toPctOrNull(body.stopLossPct, 0.2, 50);
  if (sl && "err" in sl) {
    return NextResponse.json({ error: "validation", message: `stop-loss ${sl.err} (%)` }, { status: 400 });
  }
  const takeProfitPct = tp ? tp.n : null;
  const stopLossPct = sl ? sl.n : null;

  /* Exit style: FIXED (percent bands) or VOL (volatility-scaled + trailing).
     Anything but an explicit "VOL" resolves to FIXED — old clients stay valid. */
  const exitStyle = body.exitStyle === "VOL" ? "VOL" : "FIXED";

  if (!paper && enabled && !confirmLive) {
    return NextResponse.json(
      { error: "confirm_live", message: "enabling a LIVE bot requires explicit confirmation" },
      { status: 400 }
    );
  }

  const data = { mode, symbol, paper, enabled, orderSizeUsdt, maxTradesPerDay, dailyLossLimitUsdt, takeProfitPct, stopLossPct, exitStyle };

  /* Path A — explicit bot id: update that bot (owner-checked). */
  const rawId = typeof body.id === "string" ? body.id.trim() : "";
  if (rawId) {
    const existing = await db.botConfig.findFirst({ where: { id: rawId, userId: user.id } });
    if (!existing) {
      return NextResponse.json({ error: "not_found", message: "bot not found" }, { status: 404 });
    }
    if (symbol !== existing.symbol) {
      const clash = await db.botConfig.findUnique({ where: { userId_symbol: { userId: user.id, symbol } } });
      if (clash) {
        return NextResponse.json({ error: "symbol_exists", message: `another bot already runs ${symbol}` }, { status: 409 });
      }
    }
    const config = await db.botConfig.update({ where: { id: existing.id }, data });
    return NextResponse.json({ ok: true, config });
  }

  /* Path B — upsert by (userId, symbol): keeps old single-bot clients working
     (they send no id) and is exactly "edit the bot of this symbol". */
  const existing = await db.botConfig.findUnique({ where: { userId_symbol: { userId: user.id, symbol } } });
  if (existing) {
    const config = await db.botConfig.update({ where: { id: existing.id }, data });
    return NextResponse.json({ ok: true, config });
  }

  /* Path C — create a NEW bot: enforce the approved quotas (5 paper / 2 live). */
  const sameKind = await db.botConfig.count({ where: { userId: user.id, paper } });
  if (paper && sameKind >= MAX_PAPER_BOTS) {
    return NextResponse.json({ error: "quota_paper", message: `max ${MAX_PAPER_BOTS} paper bots` }, { status: 409 });
  }
  if (!paper && sameKind >= MAX_LIVE_BOTS) {
    return NextResponse.json({ error: "quota_live", message: `max ${MAX_LIVE_BOTS} live bots` }, { status: 409 });
  }
  const config = await db.botConfig.create({ data: { userId: user.id, ...data } });
  return NextResponse.json({ ok: true, config });
}

export async function DELETE(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  await ensureBotColumns();

  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!id) {
    return NextResponse.json({ error: "validation", message: "id is required" }, { status: 400 });
  }
  const cfg = await db.botConfig.findFirst({ where: { id, userId: user.id } });
  if (!cfg) {
    return NextResponse.json({ error: "not_found", message: "bot not found" }, { status: 404 });
  }
  const open = await db.botPosition.count({ where: { configId: id, status: "OPEN" } });
  if (open > 0) {
    return NextResponse.json(
      { error: "open_position", message: "bot has an open position — close it first" },
      { status: 409 }
    );
  }
  await db.botConfig.delete({ where: { id } }); // cascades trades + closed positions
  return NextResponse.json({ ok: true });
}
