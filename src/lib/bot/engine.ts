/**
 * Bot tick engine — one pass = one decision per enabled bot.
 *
 * Per tick, per bot:
 *   1. Load config, open positions, today's trade stats (UTC day).
 *   2. Public data: 4H closes + live ticker + live exchange minimum order.
 *   3. OPEN position  → exit ladder: take-profit / stop-loss / signal-flip.
 *   4. NO position    → risk gates (max trades/day, daily loss limit,
 *      cooldown) → composite score ≥ entry threshold → BUY.
 *   5. Paper mode simulates the fill at the live ticker price; live mode
 *      sends a signed market order (clientOid = idempotency key) and refines
 *      the entry from the order's average fill price.
 *
 * Every action lands in BotTrade — the audit trail. The engine never throws
 * for a single bot; errors are recorded per-bot and the batch continues.
 */

import { randomUUID } from "crypto";
import { db } from "@/lib/db";
import { decryptSecret } from "@/lib/secure";
import {
  fetchCloses,
  fetchTickerPrice,
  fetchSpotProduct,
  placeSpotMarketOrder,
  fetchOrderFill,
} from "./bitget-trade";
import { computeBotSignal, MODE_PRESETS, shouldEnter, shouldExit, type BotMode } from "./strategy";

/** Cron guard: skip a bot ticked less than this ago (schedule jitter safety). */
const MIN_TICK_GAP_MS = 4 * 60_000;
/** Fallback minimum when the exchange rules cannot be fetched. */
const FALLBACK_MIN_USDT = 5;

export interface TickOutcome {
  userId: string;
  symbol: string;
  paper: boolean;
  action: "BUY" | "SELL" | "HOLD" | "SKIP" | "ERROR";
  reason: string;
  score?: number;
  pnlUsdt?: number;
}

interface BotConfigRow {
  id: string;
  userId: string;
  mode: string;
  symbol: string;
  paper: boolean;
  enabled: boolean;
  orderSizeUsdt: number;
  maxTradesPerDay: number;
  dailyLossLimitUsdt: number;
  lastTickAt: Date | null;
}

function utcDayStart(): Date {
  return new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
}

/** In-memory product-rules cache (exchange minimums rarely change). */
const productCache = new Map<string, { rules: { minOrderUsdt: number; quantityPrecision: number }; at: number }>();
async function minOrderUsdt(symbol: string): Promise<number> {
  const hit = productCache.get(symbol);
  if (hit && Date.now() - hit.at < 6 * 3600_000) return hit.rules.minOrderUsdt;
  try {
    const rules = await fetchSpotProduct(symbol);
    productCache.set(symbol, { rules, at: Date.now() });
    return rules.minOrderUsdt;
  } catch {
    return FALLBACK_MIN_USDT;
  }
}

async function loadCreds(userId: string) {
  const conn = await db.exchangeConnection.findFirst({
    where: { userId, exchange: "bitget", status: "active" },
    orderBy: { createdAt: "desc" },
  });
  if (!conn) return null;
  return {
    apiKey: decryptSecret(conn.apiKeyEnc),
    apiSecret: decryptSecret(conn.apiSecretEnc),
    apiPassphrase: conn.apiPassphraseEnc ? decryptSecret(conn.apiPassphraseEnc) : undefined,
  };
}

function detailJson(signal: ReturnType<typeof computeBotSignal>, extra?: Record<string, unknown>): string {
  return JSON.stringify({
    score: signal.score,
    trend: signal.trend,
    momentum: signal.momentum,
    cycle: signal.cycle,
    cycleR2: signal.cycleR2,
    cyclePosPct: signal.cyclePosPct,
    cycleRising: signal.cycleRising,
    driftPctPerBar: Number(signal.driftPctPerBar.toFixed(5)),
    volAnnPct: Number(signal.volAnnPct.toFixed(1)),
    ...extra,
  });
}

export async function runBotTicks(opts: { userId?: string; force?: boolean } = {}): Promise<TickOutcome[]> {
  /* Cron path: only ENABLED bots. Manual path (userId given, e.g. "Run now"):
     run the user's config even when disabled — that's the point of a manual
     test tick — but it still goes through every risk gate. */
  const configs = (await db.botConfig.findMany({
    where: opts.userId
      ? { userId: opts.userId }
      : { enabled: true },
  })) as BotConfigRow[];

  const outcomes: TickOutcome[] = [];
  for (const cfg of configs) {
    /* Cron guard — except explicit manual runs. */
    if (!opts.force && cfg.lastTickAt && Date.now() - cfg.lastTickAt.getTime() < MIN_TICK_GAP_MS) {
      outcomes.push({ userId: cfg.userId, symbol: cfg.symbol, paper: cfg.paper, action: "SKIP", reason: "tick guard" });
      continue;
    }
    try {
      outcomes.push(await tickOne(cfg, opts.force === true));
    } catch (err) {
      outcomes.push({
        userId: cfg.userId,
        symbol: cfg.symbol,
        paper: cfg.paper,
        action: "ERROR",
        reason: err instanceof Error ? err.message.slice(0, 200) : "unknown error",
      });
    }
  }
  return outcomes;
}

async function tickOne(cfg: BotConfigRow, force: boolean): Promise<TickOutcome> {
  const preset = MODE_PRESETS[(cfg.mode as BotMode) in MODE_PRESETS ? (cfg.mode as BotMode) : "MODERATE"];
  const creds = cfg.paper ? null : await loadCreds(cfg.userId);
  if (!cfg.paper && !creds) {
    await logTrade(cfg, {
      action: "HOLD",
      status: "FAILED",
      reason: "no active Bitget connection for live mode",
    });
    return { userId: cfg.userId, symbol: cfg.symbol, paper: cfg.paper, action: "ERROR", reason: "no bitget connection" };
  }

  const { closes } = await fetchCloses(cfg.symbol, 160);
  const price = await fetchTickerPrice(cfg.symbol);
  const minUsdt = await minOrderUsdt(cfg.symbol);
  const signal = computeBotSignal(closes);

  const openPositions = await db.botPosition.findMany({
    where: { configId: cfg.id, status: "OPEN" },
    orderBy: { openedAt: "asc" },
  });

  /* ---- 1. Exits first ---- */
  for (const pos of openPositions) {
    const { exit, reason } = shouldExit(signal, pos.entryPrice, price, pos.targetPrice, pos.stopPrice, cfg.mode as BotMode);
    if (!exit) {
      await db.botConfig.update({ where: { id: cfg.id }, data: { lastTickAt: new Date() } });
      return {
        userId: cfg.userId,
        symbol: cfg.symbol,
        paper: cfg.paper,
        action: "HOLD",
        reason,
        score: signal.score,
      };
    }
    const pnl = ((price - pos.entryPrice) / pos.entryPrice) * pos.sizeUsdt;
    if (cfg.paper) {
      await closePosition(pos.id, price, pnl, reason);
      await logTrade(cfg, {
        action: "SELL",
        status: "PAPER",
        sizeUsdt: pos.sizeUsdt,
        qty: pos.qty,
        price,
        reason,
        pnlUsdt: pnl,
        detail: detailJson(signal, { exit }),
      });
      await db.botConfig.update({ where: { id: cfg.id }, data: { lastTickAt: new Date() } });
      return { userId: cfg.userId, symbol: cfg.symbol, paper: true, action: "SELL", reason, pnlUsdt: pnl, score: signal.score };
    }
    /* live SELL: base quantity, precision-clipped */
    const qtyStr = pos.qty.toFixed(8).replace(/0+$/, "").replace(/\.$/, "");
    try {
      const placed = await placeSpotMarketOrder(creds!, { symbol: cfg.symbol, side: "sell", quantity: qtyStr });
      const fill = await fetchOrderFill(creds!, cfg.symbol, placed.orderId);
      const exitPrice = fill.priceAvg ?? price;
      const exitQty = fill.baseVolume ?? pos.qty;
      const livePnl = ((exitPrice - pos.entryPrice) / pos.entryPrice) * pos.sizeUsdt;
      await closePosition(pos.id, exitPrice, livePnl, reason);
      await logTrade(cfg, {
        action: "SELL",
        status: "SUBMITTED",
        sizeUsdt: pos.sizeUsdt,
        qty: exitQty,
        price: exitPrice,
        orderId: placed.orderId,
        clientOid: placed.clientOid,
        reason,
        pnlUsdt: livePnl,
        detail: detailJson(signal, { exit, fillStatus: fill.status }),
      });
      await db.botConfig.update({ where: { id: cfg.id }, data: { lastTickAt: new Date() } });
      return { userId: cfg.userId, symbol: cfg.symbol, paper: false, action: "SELL", reason, pnlUsdt: livePnl, score: signal.score };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "sell failed";
      await logTrade(cfg, { action: "SELL", status: "FAILED", reason: msg, detail: detailJson(signal, { exit }) });
      await db.botConfig.update({ where: { id: cfg.id }, data: { lastTickAt: new Date() } });
      return { userId: cfg.userId, symbol: cfg.symbol, paper: false, action: "ERROR", reason: msg };
    }
  }

  /* ---- 2. Risk gates for a new entry ---- */
  const dayStart = utcDayStart();
  const todayTrades = await db.botTrade.findMany({
    where: { configId: cfg.id, createdAt: { gte: dayStart }, action: { in: ["BUY", "SELL"] }, status: { in: ["PAPER", "SUBMITTED"] }, paper: cfg.paper },
    orderBy: { createdAt: "desc" },
  });
  if (todayTrades.length >= preset.maxTradesPerDay) {
    await db.botConfig.update({ where: { id: cfg.id }, data: { lastTickAt: new Date() } });
    return { userId: cfg.userId, symbol: cfg.symbol, paper: cfg.paper, action: "HOLD", reason: `max ${preset.maxTradesPerDay} trades/day`, score: signal.score };
  }
  const realizedToday = todayTrades.reduce((acc, tr) => acc + (tr.pnlUsdt ?? 0), 0);
  if (realizedToday <= -Math.abs(cfg.dailyLossLimitUsdt)) {
    await db.botConfig.update({ where: { id: cfg.id }, data: { lastTickAt: new Date() } });
    return { userId: cfg.userId, symbol: cfg.symbol, paper: cfg.paper, action: "HOLD", reason: `daily loss limit hit (${realizedToday.toFixed(2)} USDT)`, score: signal.score };
  }
  const lastClosed = await db.botPosition.findFirst({
    where: { configId: cfg.id, status: "CLOSED", paper: cfg.paper, closedAt: { not: null } },
    orderBy: { closedAt: "desc" },
  });
  if (lastClosed?.closedAt && Date.now() - lastClosed.closedAt.getTime() < preset.cooldownMin * 60_000) {
    await db.botConfig.update({ where: { id: cfg.id }, data: { lastTickAt: new Date() } });
    return { userId: cfg.userId, symbol: cfg.symbol, paper: cfg.paper, action: "HOLD", reason: `cooldown ${preset.cooldownMin}m`, score: signal.score };
  }

  /* ---- 3. Entry decision ---- */
  if (!shouldEnter(signal, cfg.mode as BotMode)) {
    await db.botConfig.update({ where: { id: cfg.id }, data: { lastTickAt: new Date() } });
    return { userId: cfg.userId, symbol: cfg.symbol, paper: cfg.paper, action: "HOLD", reason: `score ${signal.score.toFixed(2)} < entry ${preset.entryScore.toFixed(2)}`, score: signal.score };
  }

  const sizeUsdt = Math.max(cfg.orderSizeUsdt, minUsdt > 0 ? minUsdt : FALLBACK_MIN_USDT);
  const clampNote = sizeUsdt > cfg.orderSizeUsdt ? ` (clamped to exchange min ${minUsdt})` : "";
  const entryReason = `score ${signal.score.toFixed(2)} ≥ entry ${preset.entryScore.toFixed(2)}${clampNote}`;

  if (cfg.paper) {
    const qty = sizeUsdt / price;
    await db.botPosition.create({
      data: {
        userId: cfg.userId,
        configId: cfg.id,
        symbol: cfg.symbol,
        side: "LONG",
        entryPrice: price,
        qty,
        sizeUsdt,
        paper: true,
        stopPrice: price * (1 - preset.stopLossPct / 100),
        targetPrice: price * (1 + preset.takeProfitPct / 100),
        status: "OPEN",
      },
    });
    await logTrade(cfg, {
      action: "BUY",
      status: "PAPER",
      sizeUsdt,
      qty,
      price,
      reason: entryReason,
      detail: detailJson(signal),
    });
    await db.botConfig.update({ where: { id: cfg.id }, data: { lastTickAt: new Date() } });
    return { userId: cfg.userId, symbol: cfg.symbol, paper: true, action: "BUY", reason: entryReason, score: signal.score };
  }

  /* live BUY: quote amount (USDT), 2dp */
  try {
    const placed = await placeSpotMarketOrder(creds!, {
      symbol: cfg.symbol,
      side: "buy",
      quantity: sizeUsdt.toFixed(2),
    });
    const fill = await fetchOrderFill(creds!, cfg.symbol, placed.orderId);
    const entryPrice = fill.priceAvg ?? price;
    const qty = fill.baseVolume ?? sizeUsdt / entryPrice;
    await db.botPosition.create({
      data: {
        userId: cfg.userId,
        configId: cfg.id,
        symbol: cfg.symbol,
        side: "LONG",
        entryPrice,
        qty,
        sizeUsdt,
        paper: false,
        stopPrice: entryPrice * (1 - preset.stopLossPct / 100),
        targetPrice: entryPrice * (1 + preset.takeProfitPct / 100),
        status: "OPEN",
      },
    });
    await logTrade(cfg, {
      action: "BUY",
      status: "SUBMITTED",
      sizeUsdt,
      qty,
      price: entryPrice,
      orderId: placed.orderId,
      clientOid: placed.clientOid,
      reason: entryReason,
      detail: detailJson(signal, { fillStatus: fill.status }),
    });
    await db.botConfig.update({ where: { id: cfg.id }, data: { lastTickAt: new Date() } });
    return { userId: cfg.userId, symbol: cfg.symbol, paper: false, action: "BUY", reason: entryReason, score: signal.score };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "buy failed";
    await logTrade(cfg, { action: "BUY", status: "FAILED", sizeUsdt, reason: msg, detail: detailJson(signal) });
    await db.botConfig.update({ where: { id: cfg.id }, data: { lastTickAt: new Date() } });
    return { userId: cfg.userId, symbol: cfg.symbol, paper: false, action: "ERROR", reason: msg };
  }
}

async function closePosition(id: string, exitPrice: number, pnlUsdt: number, exitReason: string) {
  await db.botPosition.update({
    where: { id },
    data: { status: "CLOSED", exitPrice, realizedPnlUsdt: pnlUsdt, exitReason, closedAt: new Date() },
  });
}

async function logTrade(
  cfg: BotConfigRow,
  data: {
    action: "BUY" | "SELL" | "HOLD";
    status: "PAPER" | "SUBMITTED" | "FAILED";
    reason: string;
    sizeUsdt?: number;
    qty?: number;
    price?: number;
    orderId?: string;
    clientOid?: string;
    pnlUsdt?: number;
    detail?: string;
  }
) {
  await db.botTrade.create({
    data: {
      userId: cfg.userId,
      configId: cfg.id,
      symbol: cfg.symbol,
      action: data.action,
      paper: cfg.paper,
      sizeUsdt: data.sizeUsdt ?? null,
      qty: data.qty ?? null,
      price: data.price ?? null,
      orderId: data.orderId ?? null,
      clientOid: data.clientOid ?? randomUUID(),
      status: data.status,
      reason: data.reason.slice(0, 240),
      detail: data.detail ?? null,
      pnlUsdt: data.pnlUsdt ?? null,
    },
  });
}
