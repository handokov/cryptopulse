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

import { NextRequest, NextResponse, after } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { runBotTicks } from "@/lib/bot/engine";
import { MODE_PRESETS, TF_OPTIONS, TF_DEFAULT, cooldownMinFor, type BotMode, type BotTimeframe } from "@/lib/bot/strategy";
import { tfMsFor } from "@/lib/bot/timeframes";
import { ensureBotColumns } from "@/lib/bot/migrate";
import { getTickerRows, num } from "@/lib/market/smallcaps";
import { decryptSecret } from "@/lib/secure";
import { fetchSpotBalance } from "@/lib/bot/bitget-trade";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SYMBOL_RE = /^[A-Z0-9]{2,10}USDT$/;
const MAX_PAPER_BOTS = 5;
const MAX_LIVE_BOTS = 2;

/* spot USDT availability cache — signed call, so keep it to 1 per 30s/user */
const spotAvailCache = new Map<string, { available: number | null; at: number }>();

function defaults(userId: string, symbol: string) {
  return {
    userId,
    mode: "MODERATE" as BotMode,
    symbol,
    paper: true,
    enabled: false,
    orderSizeUsdt: 5,
    paperCapitalUsdt: 20,
    maxTradesPerDay: MODE_PRESETS.MODERATE.maxTradesPerDay,
    dailyLossLimitUsdt: 20,
    exitStyle: "FIXED" as const,
    timeframe: "4H" as BotTimeframe,
    entryLine: null as number | null,
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
    /* Effective daily cap: the user's saved setting (1..20) when sane, preset
       only as fallback — must mirror the engine gate, which reads the same
       value. Before this fix the tile always showed the preset (4/8) even
       after the user saved a different number. */
    maxTradesPerDay: config
      ? Number.isInteger(config.maxTradesPerDay) && config.maxTradesPerDay >= 1 && config.maxTradesPerDay <= 20
        ? config.maxTradesPerDay
        : MODE_PRESETS[(config.mode as BotMode) in MODE_PRESETS ? (config.mode as BotMode) : "MODERATE"].maxTradesPerDay
      : null,
    cooldownMin: config ? cooldownMinFor((config.mode as BotMode) in MODE_PRESETS ? (config.mode as BotMode) : "MODERATE", config.timeframe ?? "4H") : null,
    timeframe: config?.timeframe ?? null,
    presets: MODE_PRESETS,
    tfOptions: TF_OPTIONS,
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
  /* Trade-history durations (Task 19) — how long a position lives before it
     exits, split by outcome so the user can see how fast profit vs loss
     materialises. Minutes, computed from openedAt → closedAt. */
  const durMin = (p: (typeof closed)[number]) =>
    p.closedAt && p.openedAt ? Math.max(0, (p.closedAt.getTime() - p.openedAt.getTime()) / 60_000) : null;
  const allDurs = closed.map(durMin).filter((v): v is number => v != null);
  const winDurs = closed.filter((p) => (p.realizedPnlUsdt ?? 0) > 0).map(durMin).filter((v): v is number => v != null);
  const lossDurs = closed.filter((p) => (p.realizedPnlUsdt ?? 0) < 0).map(durMin).filter((v): v is number => v != null);
  const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
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
    avgDurationMin: avg(allDurs),
    avgWinDurationMin: avg(winDurs),
    avgLossDurationMin: avg(lossDurs),
    exitCounts,
    dailyPnl,
  };

  /* Trade history (Task 19) — the last 50 closed positions of the active
     bot in the current mode, newest first, for the Riwayat Trade table. */
  const history = [...closed]
    .sort((a, b) => (b.closedAt?.getTime() ?? 0) - (a.closedAt?.getTime() ?? 0))
    .slice(0, 50)
    .map((p) => ({
      id: p.id,
      symbol: p.symbol,
      paper: p.paper,
      entryPrice: p.entryPrice,
      exitPrice: p.exitPrice,
      qty: p.qty,
      sizeUsdt: p.sizeUsdt,
      realizedPnlUsdt: p.realizedPnlUsdt,
      exitReason: p.exitReason,
      tpslArmed: p.tpslArmed,
      openedAt: p.openedAt.toISOString(),
      closedAt: p.closedAt?.toISOString() ?? null,
    }));

  /* multi-bot payload: light list + quota usage */
  const bots = configs.map((c) => ({
    id: c.id,
    symbol: c.symbol,
    mode: c.mode as BotMode,
    paper: c.paper,
    enabled: c.enabled,
    exitStyle: c.exitStyle ?? "FIXED",
    orderSizeUsdt: c.orderSizeUsdt,
    timeframe: c.timeframe ?? "4H",
    entryLine: c.entryLine ?? null,
    entryOffsetPct: c.entryOffsetPct ?? 0.3,
  }));
  const quota = {
    paper: configs.filter((c) => c.paper).length,
    live: configs.filter((c) => !c.paper).length,
    maxPaper: MAX_PAPER_BOTS,
    maxLive: MAX_LIVE_BOTS,
  };

  /* ---- portfolio aggregate across ALL bots of this user ---- */
  const allIds = configs.map((c) => c.id);
  const [allClosed, allTodaySells] = await Promise.all([
    allIds.length
      ? db.botPosition.findMany({
          where: { configId: { in: allIds }, status: "CLOSED" },
          select: { configId: true, realizedPnlUsdt: true, closedAt: true },
        })
      : Promise.resolve([] as { configId: string; realizedPnlUsdt: number | null; closedAt: Date | null }[]),
    allIds.length
      ? db.botTrade.findMany({
          where: { configId: { in: allIds }, createdAt: { gte: dayStart }, action: "SELL", status: { in: ["PAPER", "SUBMITTED"] } },
          select: { configId: true, pnlUsdt: true },
        })
      : Promise.resolve([] as { configId: string; pnlUsdt: number | null }[]),
  ]);
  const perBotMap = new Map<string, { symbol: string; totalUsdt: number; todayUsdt: number; monthUsdt: number; closed: number }>();
  for (const c of configs) perBotMap.set(c.id, { symbol: c.symbol, totalUsdt: 0, todayUsdt: 0, monthUsdt: 0, closed: 0 });
  let pfTotal = 0;
  let pfToday = 0;
  let pfMonth = 0;
  let pfMonthCount = 0;
  const monthStart = Date.now() - 30 * 86_400_000;
  for (const p of allClosed) {
    const amt = p.realizedPnlUsdt ?? 0;
    pfTotal += amt;
    const row = perBotMap.get(p.configId);
    if (row) {
      row.totalUsdt += amt;
      row.closed += 1;
    }
    if (p.closedAt && new Date(p.closedAt).getTime() >= monthStart) {
      pfMonth += amt;
      pfMonthCount += 1;
      if (row) row.monthUsdt += amt;
    }
  }
  for (const tr of allTodaySells) {
    const amt = tr.pnlUsdt ?? 0;
    pfToday += amt;
    const row = perBotMap.get(tr.configId);
    if (row) row.todayUsdt += amt;
  }
  const portfolio = {
    bots: configs.length,
    botsActive: configs.filter((c) => c.enabled).length,
    totalUsdt: pfTotal,
    todayUsdt: pfToday,
    monthUsdt: pfMonth,
    monthCount: pfMonthCount,
    closedCount: allClosed.length,
    todayCount: allTodaySells.length,
    perBot: [...perBotMap.values()].sort((a, b) => b.totalUsdt - a.totalUsdt),
  };

  /* ---- paper wallet — mark every open position to the live Bitget ticker ----
     One cached all-tickers call (60s) covers every symbol. Without a live
     mark, unrealized stays 0 and `hasMark=false` so the UI can say so
     instead of silently faking equity. */
  const allIdsOpen = allIds.length
    ? await db.botPosition.findMany({
        where: { configId: { in: allIds }, status: "OPEN" },
        select: { configId: true, symbol: true, entryPrice: true, sizeUsdt: true, paper: true },
      })
    : [];
  const markBySymbol = new Map<string, number>();
  try {
    for (const r of (await getTickerRows()) ?? []) {
      const s = String(r.symbol ?? "");
      const p = num(r.lastPr);
      if (s && p > 0) markBySymbol.set(s, p);
    }
  } catch {
    /* upstream hiccup — marks stay unavailable, wallet degrades gracefully */
  }
  const unrealizedOf = (symbol: string, entryPrice: number, sizeUsdt: number): number | null => {
    const mark = markBySymbol.get(symbol);
    return mark != null ? ((mark - entryPrice) / entryPrice) * sizeUsdt : null;
  };

  /* active bot wallet: capital + realized (closed, mode-matched) + unrealized */
  const openActive = allIdsOpen.filter((p) => p.configId === configId && p.paper === paperFlag);
  const unrealizedActive = openActive.reduce<number | null>((acc, p) => {
    const u = unrealizedOf(p.symbol, p.entryPrice, p.sizeUsdt);
    if (u === null) return acc; // missing mark on one row — skip it
    return (acc ?? 0) + u;
  }, null);
  const capitalActive = config?.paperCapitalUsdt ?? 20;
  const realizedActive = stats.totalPnlUsdt;
  const openSizeActive = openActive.reduce((acc, p) => acc + p.sizeUsdt, 0);
  const wallet = {
    paper: paperFlag,
    capital: capitalActive,
    realized: realizedActive,
    unrealized: unrealizedActive ?? 0,
    hasMark: unrealizedActive !== null || openActive.length === 0,
    equity: capitalActive + realizedActive + (unrealizedActive ?? 0),
    pnlUsdt: realizedActive + (unrealizedActive ?? 0),
    pnlPct: capitalActive > 0 ? ((realizedActive + (unrealizedActive ?? 0)) / capitalActive) * 100 : 0,
    openCount: openActive.length,
    openSize: openSizeActive,
    free: capitalActive + realizedActive - openSizeActive,
  };

  /* portfolio wallet: aggregate over PAPER bots only (live money is real) */
  const paperIds = new Set(configs.filter((c) => c.paper).map((c) => c.id));
  let pfCapital = 0;
  for (const c of configs) {
    if (!paperIds.has(c.id)) continue;
    pfCapital += c.paperCapitalUsdt ?? 20;
  }
  /* equity starts FROM the capital sum — must run after the loop above */
  let pfEquity = pfCapital;
  let pfHasMark = true;
  for (const p of allClosed) {
    if (paperIds.has(p.configId)) pfEquity += p.realizedPnlUsdt ?? 0;
  }
  for (const p of allIdsOpen) {
    if (!paperIds.has(p.configId)) continue;
    const u = unrealizedOf(p.symbol, p.entryPrice, p.sizeUsdt);
    if (u === null) pfHasMark = false;
    else pfEquity += u;
  }
  const portfolioWallet = { capitalUsdt: pfCapital, equityUsdt: pfEquity, pnlUsdt: pfEquity - pfCapital, hasMark: pfHasMark };

  /* positions table rows carry their own mark + unrealized for display */
  const positionsOut = positions.map((p) => {
    const mark = markBySymbol.get(p.symbol) ?? null;
    return { ...p, markPrice: mark, unrealizedUsdt: mark != null ? ((mark - p.entryPrice) / p.entryPrice) * p.sizeUsdt : null };
  });

  /* active-bot pending limit entry (paper maker-style / live post-only) —
     UI countdown fuel. `live` tells the client this is a REAL resting order. */
  const pending =
    config?.pendingEntryPrice != null
      ? {
          price: config.pendingEntryPrice,
          sizeUsdt: config.pendingEntrySize ?? null,
          placedAt: config.pendingEntryAt?.toISOString() ?? null,
          expiresAt: config.pendingEntryAt
            ? new Date(config.pendingEntryAt.getTime() + 3 * tfMsFor(config.timeframe ?? "4H")).toISOString()
            : null,
          orderId: (config as { pendingEntryOrderId?: string | null }).pendingEntryOrderId ?? null,
          live: !paperFlag,
        }
      : null;

  /* live wallet — the REAL spot USDT balance that funds live entries
     (Task 14 design: modal bot diambil dari saldo spot Bitget). Cached to
     keep the signed API call at most one per 30s. null = unavailable
     (no connection / upstream error) so the UI can say so honestly.
     Task 17: also report the connection itself + its trade-permission
     verdict so the UI can distinguish "not connected" from "read-only key"
     from "connected". */
  let spot: {
    coin: string;
    available: number | null;
    connected: boolean;
    tradePermission: string | null;
  } | null = null;
  if (config && !paperFlag) {
    const conn = await db.exchangeConnection.findFirst({
      where: { userId: user.id, exchange: "bitget", status: "active" },
      orderBy: { createdAt: "desc" },
      select: { id: true, apiKeyEnc: true, apiSecretEnc: true, apiPassphraseEnc: true, tradePermission: true },
    });
    const hit = spotAvailCache.get(user.id);
    let available: number | null;
    if (hit && Date.now() - hit.at < 30_000) {
      available = hit.available;
    } else {
      available = null;
      try {
        if (conn) {
          const bal = await fetchSpotBalance(
            {
              apiKey: decryptSecret(conn.apiKeyEnc),
              apiSecret: decryptSecret(conn.apiSecretEnc),
              apiPassphrase: conn.apiPassphraseEnc ? decryptSecret(conn.apiPassphraseEnc) : undefined,
            },
            "USDT"
          );
          available = bal ? bal.available : null;
        }
      } catch {
        available = null;
      }
      spotAvailCache.set(user.id, { available, at: Date.now() });
    }
    spot = {
      coin: "USDT",
      available,
      connected: Boolean(conn),
      tradePermission: conn ? ((conn as { tradePermission?: string }).tradePermission ?? "unverified") : null,
    };
  }

  /* Opportunistic guardian tick — every dashboard load doubles as a heartbeat
     fallback for when the GitHub cron is degraded (measured 2-7 h gaps on the
     free tier). Guarded by the engine's 4-min min-gap, exits always evaluated,
     entries only for enabled bots. Runs AFTER the response — the dashboard
     never waits on it and never fails because of it. */
  after(async () => {
    try {
      await runBotTicks({ userId: user.id, force: false });
    } catch {
      /* best-effort heartbeat */
    }
  });

  return NextResponse.json({
    config: config ?? { ...defaults(user.id, wantSymbol || "BTCUSDT"), id: null },
    bots,
    quota,
    positions: positionsOut,
    history,
    trades,
    summary,
    stats,
    portfolio: { ...portfolio, wallet: portfolioWallet },
    wallet,
    pending,
    spot,
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
  if (!Number.isFinite(orderSizeUsdt) || orderSizeUsdt < 1 || orderSizeUsdt > 1000) {
    return NextResponse.json({ error: "validation", message: "order size must be between 1 and 1000 USDT" }, { status: 400 });
  }
  /* Paper-wallet capital — optional on update (absent = keep current). */
  let paperCapitalUsdt: number | undefined;
  if (body.paperCapitalUsdt !== undefined && body.paperCapitalUsdt !== null && body.paperCapitalUsdt !== "") {
    const n = Number(body.paperCapitalUsdt);
    if (!Number.isFinite(n) || n < 1 || n > 100000) {
      return NextResponse.json({ error: "validation", message: "paper capital must be 1..100000 USDT" }, { status: 400 });
    }
    paperCapitalUsdt = n;
  }
  /* Paper maker-entry offset — optional on update (absent = keep current).
     0 disables it (legacy market entry); max 5% below market. */
  let entryOffsetPct: number | undefined;
  if (body.entryOffsetPct !== undefined && body.entryOffsetPct !== null && body.entryOffsetPct !== "") {
    const n = Number(body.entryOffsetPct);
    if (!Number.isFinite(n) || n < 0 || n > 5) {
      return NextResponse.json({ error: "validation", message: "entry offset must be 0..5 (%)" }, { status: 400 });
    }
    entryOffsetPct = n;
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

  /* v2 phase 2 — signal timeframe, gated by mode (user-approved design:
     MODERATE 1H/4H/1D, AGGRESSIVE 15M/30M/1H). Invalid/absent → mode default. */
  const tfOpts = TF_OPTIONS[mode as BotMode] ?? TF_OPTIONS.MODERATE;
  const rawTf = typeof body.timeframe === "string" ? body.timeframe.toUpperCase() : "";
  const timeframe: BotTimeframe = tfOpts.includes(rawTf as BotTimeframe)
    ? (rawTf as BotTimeframe)
    : TF_DEFAULT[mode as BotMode] ?? "4H";

  /* v2 phase 2 — entry line: null = gate OFF; otherwise a positive price. */
  let entryLine: number | null = null;
  if (body.entryLine !== null && body.entryLine !== undefined && body.entryLine !== "") {
    const n = Number(body.entryLine);
    if (!Number.isFinite(n) || n <= 0 || n > 1e12) {
      return NextResponse.json({ error: "validation", message: "entry line must be a positive price" }, { status: 400 });
    }
    entryLine = n;
  }

  if (!paper && enabled && !confirmLive) {
    return NextResponse.json(
      { error: "confirm_live", message: "enabling a LIVE bot requires explicit confirmation" },
      { status: 400 }
    );
  }

  const data = { mode, symbol, paper, enabled, orderSizeUsdt, maxTradesPerDay, dailyLossLimitUsdt, takeProfitPct, stopLossPct, exitStyle, timeframe, entryLine };

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
    const config = await db.botConfig.update({
      where: { id: existing.id },
      data: { ...data, paperCapitalUsdt: paperCapitalUsdt ?? existing.paperCapitalUsdt ?? 20, entryOffsetPct: entryOffsetPct ?? existing.entryOffsetPct ?? 0.3 },
    });
    return NextResponse.json({ ok: true, config });
  }

  /* Path B — upsert by (userId, symbol): keeps old single-bot clients working
     (they send no id) and is exactly "edit the bot of this symbol". */
  const existing = await db.botConfig.findUnique({ where: { userId_symbol: { userId: user.id, symbol } } });
  if (existing) {
    const config = await db.botConfig.update({
      where: { id: existing.id },
      data: { ...data, paperCapitalUsdt: paperCapitalUsdt ?? existing.paperCapitalUsdt ?? 20, entryOffsetPct: entryOffsetPct ?? existing.entryOffsetPct ?? 0.3 },
    });
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
  const config = await db.botConfig.create({
    data: { userId: user.id, ...data, paperCapitalUsdt: paperCapitalUsdt ?? 20, entryOffsetPct: entryOffsetPct ?? 0.3 },
  });
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
