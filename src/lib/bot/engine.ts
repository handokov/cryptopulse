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
  barsPerYearFor,
} from "./bitget-trade";
import {
  computeBotSignal,
  MODE_PRESETS,
  shouldEnter,
  shouldExit,
  volBands,
  cooldownMinFor,
  isBotTimeframe,
  type BotMode,
} from "./strategy";

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
  takeProfitPct: number | null;
  stopLossPct: number | null;
  exitStyle: string | null;
  /* v2 phase 2 — signal timeframe + armed entry line + tick bookkeeping. */
  timeframe: string | null;
  entryLine: number | null;
  lastPrice: number | null;
  lastTickAt: Date | null;
}

/** Minimal shape the audit-log helper needs. */
type TradeLogConfig = Pick<BotConfigRow, "id" | "userId" | "symbol" | "paper">;

function utcDayStart(): Date {
  return new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
}

/** Stamp a completed tick: lastTickAt (cron guard) + lastPrice (line-crossing detector). */
async function touchConfig(cfgId: string, price?: number) {
  await db.botConfig.update({
    where: { id: cfgId },
    data: {
      lastTickAt: new Date(),
      ...(price != null && Number.isFinite(price) && price > 0 ? { lastPrice: price } : {}),
    },
  });
}

/**
 * v2 phase 2 — did the live price TOUCH the user's entry line this tick?
 * Any-touch semantics (design 26-b): a crossing between the previous tick
 * price and now (robust to gaps past the level) OR the price sitting within
 * ±0.1% of the line right now. With a 5-min cadence this never misses a
 * move through the level between ticks.
 */
export function entryLineTouched(line: number, prevPrice: number | null, price: number): boolean {
  if (!Number.isFinite(line) || line <= 0) return false;
  const eps = line * 0.001; // ±0.1% touch band
  if (Math.abs(price - line) <= eps) return true;
  if (prevPrice != null && prevPrice > 0) {
    if (prevPrice < line && price >= line) return true; // upward crossing
    if (prevPrice > line && price <= line) return true; // downward crossing
  }
  return false;
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
  /* v2 phase 2 — signal timeframe (4H default = legacy behavior, zero regression). */
  const tf = isBotTimeframe(cfg.timeframe) ? cfg.timeframe : "4H";
  const bpy = barsPerYearFor(tf);
  const cooldownMin = cooldownMinFor((cfg.mode as BotMode) in MODE_PRESETS ? (cfg.mode as BotMode) : "MODERATE", tf);
  /* Exit ladder: user overrides win when set (>0), otherwise the mode preset. */
  const tpPct = cfg.takeProfitPct && cfg.takeProfitPct > 0 ? cfg.takeProfitPct : preset.takeProfitPct;
  const slPct = cfg.stopLossPct && cfg.stopLossPct > 0 ? cfg.stopLossPct : preset.stopLossPct;
  const creds = cfg.paper ? null : await loadCreds(cfg.userId);
  if (!cfg.paper && !creds) {
    await logTrade(cfg, {
      action: "HOLD",
      status: "FAILED",
      reason: "no active Bitget connection for live mode",
    });
    return { userId: cfg.userId, symbol: cfg.symbol, paper: cfg.paper, action: "ERROR", reason: "no bitget connection" };
  }

  const { closes } = await fetchCloses(cfg.symbol, 160, tf);
  const price = await fetchTickerPrice(cfg.symbol);
  const minUsdt = await minOrderUsdt(cfg.symbol);
  const signal = computeBotSignal(closes, bpy);

  /* VOL exit style — bands scale with the symbol's own volatility ON THE
     SELECTED TIMEFRAME. σ(per bar) derived from the signal's annualized
     figure; user overrides still win per-band; trailing stop armed once
     the move clears +1σ. */
  const volMode = (cfg.exitStyle ?? "FIXED") === "VOL";
  let vol: ReturnType<typeof volBands> | null = null;
  if (volMode) {
    const sigmaPct = (signal.volAnnPct / 100) / Math.sqrt(bpy) * 100; // % per bar on this TF
    vol = volBands(sigmaPct, (cfg.mode as BotMode) in MODE_PRESETS ? (cfg.mode as BotMode) : "MODERATE");
  }
  const effTpPct = vol && !(cfg.takeProfitPct && cfg.takeProfitPct > 0) ? vol.tpPct : tpPct;
  const effSlPct = vol && !(cfg.stopLossPct && cfg.stopLossPct > 0) ? vol.slPct : slPct;

  const openPositions = await db.botPosition.findMany({
    where: { configId: cfg.id, status: "OPEN" },
    orderBy: { openedAt: "asc" },
  });

  /* ---- 1. Exits first ---- */
  for (const pos of openPositions) {
    /* VOL: ratchet the stop upward as the price makes new highs (trailing).
       Arm only after the unrealized gain clears +1σ; trail distance = SL band. */
    let effStop = pos.stopPrice;
    let trailStopPrice: number | null = null;
    let newHighest = pos.highestPrice ?? pos.entryPrice;
    if (vol && vol.trailPct > 0) {
      newHighest = Math.max(newHighest, price);
      const gainPct = ((newHighest - pos.entryPrice) / pos.entryPrice) * 100;
      if (gainPct >= vol.trailArmPct) {
        trailStopPrice = newHighest * (1 - vol.trailPct / 100);
        effStop = Math.max(pos.stopPrice, trailStopPrice);
      }
    }
    const { exit, reason } = shouldExit(signal, pos.entryPrice, price, pos.targetPrice, effStop, cfg.mode as BotMode);
    if (!exit) {
      await db.botPosition.update({ where: { id: pos.id }, data: { highestPrice: newHighest } });
      await touchConfig(cfg.id, price);
      return {
        userId: cfg.userId,
        symbol: cfg.symbol,
        paper: cfg.paper,
        action: "HOLD",
        reason,
        score: signal.score,
      };
    }
    /* A stop-out above the original stop is a TRAIL exit — it locks profit. */
    const isTrail = exit === "stop-loss" && trailStopPrice !== null && trailStopPrice > pos.stopPrice;
    const exitKind = isTrail ? "trail-stop" : exit;
    const exitReason = isTrail
      ? `trail-stop: locked ≥ ${(((trailStopPrice - pos.entryPrice) / pos.entryPrice) * 100).toFixed(2)}% (peak ${newHighest.toPrecision(6)}, trail ${vol!.trailPct.toFixed(2)}%)`
      : reason;
    const pnl = ((price - pos.entryPrice) / pos.entryPrice) * pos.sizeUsdt;
    if (cfg.paper) {
      await closePosition(pos.id, price, pnl, exitReason);
      await logTrade(cfg, {
        action: "SELL",
        status: "PAPER",
        sizeUsdt: pos.sizeUsdt,
        qty: pos.qty,
        price,
        reason: exitReason,
        pnlUsdt: pnl,
        detail: detailJson(signal, { exit: exitKind }),
      });
      await touchConfig(cfg.id, price);
      return { userId: cfg.userId, symbol: cfg.symbol, paper: true, action: "SELL", reason: exitReason, pnlUsdt: pnl, score: signal.score };
    }
    /* live SELL: base quantity, precision-clipped */
    const qtyStr = pos.qty.toFixed(8).replace(/0+$/, "").replace(/\.$/, "");
    try {
      const placed = await placeSpotMarketOrder(creds!, { symbol: cfg.symbol, side: "sell", quantity: qtyStr });
      const fill = await fetchOrderFill(creds!, cfg.symbol, placed.orderId);
      const exitPrice = fill.priceAvg ?? price;
      const exitQty = fill.baseVolume ?? pos.qty;
      const livePnl = ((exitPrice - pos.entryPrice) / pos.entryPrice) * pos.sizeUsdt;
      await closePosition(pos.id, exitPrice, livePnl, exitReason);
      await logTrade(cfg, {
        action: "SELL",
        status: "SUBMITTED",
        sizeUsdt: pos.sizeUsdt,
        qty: exitQty,
        price: exitPrice,
        orderId: placed.orderId,
        clientOid: placed.clientOid,
        reason: exitReason,
        pnlUsdt: livePnl,
        detail: detailJson(signal, { exit: exitKind, fillStatus: fill.status }),
      });
      await touchConfig(cfg.id, price);
      return { userId: cfg.userId, symbol: cfg.symbol, paper: false, action: "SELL", reason: exitReason, pnlUsdt: livePnl, score: signal.score };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "sell failed";
      await logTrade(cfg, { action: "SELL", status: "FAILED", reason: msg, detail: detailJson(signal, { exit: exitKind }) });
      await touchConfig(cfg.id, price);
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
    await touchConfig(cfg.id, price);
    return { userId: cfg.userId, symbol: cfg.symbol, paper: cfg.paper, action: "HOLD", reason: `max ${preset.maxTradesPerDay} trades/day`, score: signal.score };
  }
  const realizedToday = todayTrades.reduce((acc, tr) => acc + (tr.pnlUsdt ?? 0), 0);
  if (realizedToday <= -Math.abs(cfg.dailyLossLimitUsdt)) {
    await touchConfig(cfg.id, price);
    return { userId: cfg.userId, symbol: cfg.symbol, paper: cfg.paper, action: "HOLD", reason: `daily loss limit hit (${realizedToday.toFixed(2)} USDT)`, score: signal.score };
  }
  const lastClosed = await db.botPosition.findFirst({
    where: { configId: cfg.id, status: "CLOSED", paper: cfg.paper, closedAt: { not: null } },
    orderBy: { closedAt: "desc" },
  });
  if (lastClosed?.closedAt && Date.now() - lastClosed.closedAt.getTime() < cooldownMin * 60_000) {
    await touchConfig(cfg.id, price);
    return { userId: cfg.userId, symbol: cfg.symbol, paper: cfg.paper, action: "HOLD", reason: `cooldown ${cooldownMin}m (${tf})`, score: signal.score };
  }

  /* ---- 3. Entry decision ---- */
  if (!shouldEnter(signal, cfg.mode as BotMode)) {
    await touchConfig(cfg.id, price);
    return { userId: cfg.userId, symbol: cfg.symbol, paper: cfg.paper, action: "HOLD", reason: `score ${signal.score.toFixed(2)} < entry ${preset.entryScore.toFixed(2)}`, score: signal.score };
  }

  /* ---- 3b. v2 phase 2 — entry-line gate (AND-scored with the score gate).
     When the user armed a line, the live price must touch or cross it this
     tick (any-touch semantics). null line = gate OFF = legacy behavior. */
  const line = cfg.entryLine != null && cfg.entryLine > 0 ? cfg.entryLine : null;
  if (line != null && !entryLineTouched(line, cfg.lastPrice ?? null, price)) {
    await touchConfig(cfg.id, price);
    return {
      userId: cfg.userId,
      symbol: cfg.symbol,
      paper: cfg.paper,
      action: "HOLD",
      reason: `entry line ${line.toPrecision(6)} not touched (price ${price.toPrecision(6)}), score ${signal.score.toFixed(2)} ok`,
      score: signal.score,
    };
  }

  const sizeUsdt = Math.max(cfg.orderSizeUsdt, minUsdt > 0 ? minUsdt : FALLBACK_MIN_USDT);
  const clampNote = sizeUsdt > cfg.orderSizeUsdt ? ` (clamped to exchange min ${minUsdt})` : "";
  const volNote = vol ? ` [VOL σ${vol.sigmaPct.toFixed(2)}%: TP +${effTpPct.toFixed(2)}%/SL −${effSlPct.toFixed(2)}%]` : "";
  const lineNote = line != null ? ` [line ${line.toPrecision(6)} touched]` : "";
  const entryReason = `score ${signal.score.toFixed(2)} ≥ entry ${preset.entryScore.toFixed(2)}${clampNote}${volNote}${lineNote}`;

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
        stopPrice: price * (1 - effSlPct / 100),
        targetPrice: price * (1 + effTpPct / 100),
        highestPrice: price,
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
    await touchConfig(cfg.id, price);
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
        stopPrice: entryPrice * (1 - effSlPct / 100),
        targetPrice: entryPrice * (1 + effTpPct / 100),
        highestPrice: entryPrice,
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
    await touchConfig(cfg.id, price);
    return { userId: cfg.userId, symbol: cfg.symbol, paper: false, action: "BUY", reason: entryReason, score: signal.score };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "buy failed";
    await logTrade(cfg, { action: "BUY", status: "FAILED", sizeUsdt, reason: msg, detail: detailJson(signal) });
    await touchConfig(cfg.id, price);
    return { userId: cfg.userId, symbol: cfg.symbol, paper: false, action: "ERROR", reason: msg };
  }
}

async function closePosition(id: string, exitPrice: number, pnlUsdt: number, exitReason: string) {
  await db.botPosition.update({
    where: { id },
    data: { status: "CLOSED", exitPrice, realizedPnlUsdt: pnlUsdt, exitReason, closedAt: new Date() },
  });
}

export interface ManualCloseResult {
  ok: boolean;
  closed: number;
  results: { positionId: string; price: number | null; pnlUsdt: number | null; error?: string }[];
}

/**
 * v2 phase 2 — "Stop & Jual" / manual close: market-close every OPEN
 * position of a config regardless of the bot's enabled state. Paper sells
 * at the live ticker; live sends a real market SELL and refines the fill.
 * Every fill lands in the same BotTrade audit trail as engine exits.
 */
export async function manualClosePositions(
  cfg: TradeLogConfig,
  reason = "manual close (stop & sell)"
): Promise<ManualCloseResult> {
  const positions = await db.botPosition.findMany({
    where: { configId: cfg.id, status: "OPEN" },
    orderBy: { openedAt: "asc" },
  });
  const out: ManualCloseResult = { ok: true, closed: 0, results: [] };
  if (positions.length === 0) return out;

  let ticker: number | null = null;
  try {
    ticker = await fetchTickerPrice(cfg.symbol);
  } catch {
    ticker = null;
  }

  let creds: Awaited<ReturnType<typeof loadCreds>> = null;
  if (!cfg.paper) {
    creds = await loadCreds(cfg.userId);
    if (!creds) {
      return {
        ok: false,
        closed: 0,
        results: positions.map((p) => ({ positionId: p.id, price: null, pnlUsdt: null, error: "no active Bitget connection for live mode" })),
      };
    }
  }

  for (const pos of positions) {
    if (cfg.paper) {
      if (!ticker) {
        out.ok = false;
        out.results.push({ positionId: pos.id, price: null, pnlUsdt: null, error: "ticker unavailable" });
        continue;
      }
      const pnl = ((ticker - pos.entryPrice) / pos.entryPrice) * pos.sizeUsdt;
      await closePosition(pos.id, ticker, pnl, reason);
      await logTrade(cfg, {
        action: "SELL",
        status: "PAPER",
        sizeUsdt: pos.sizeUsdt,
        qty: pos.qty,
        price: ticker,
        reason,
        pnlUsdt: pnl,
        detail: JSON.stringify({ manual: true }),
      });
      out.closed += 1;
      out.results.push({ positionId: pos.id, price: ticker, pnlUsdt: pnl });
      continue;
    }
    /* live SELL — same precision-clipping as the engine's exit ladder */
    try {
      const qtyStr = pos.qty.toFixed(8).replace(/0+$/, "").replace(/\.$/, "");
      const placed = await placeSpotMarketOrder(creds!, { symbol: cfg.symbol, side: "sell", quantity: qtyStr });
      const fill = await fetchOrderFill(creds!, cfg.symbol, placed.orderId);
      const exitPrice = fill.priceAvg ?? ticker ?? pos.entryPrice;
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
        detail: JSON.stringify({ manual: true, fillStatus: fill.status }),
      });
      out.closed += 1;
      out.results.push({ positionId: pos.id, price: exitPrice, pnlUsdt: livePnl });
    } catch (err) {
      const msg = err instanceof Error ? err.message.slice(0, 200) : "sell failed";
      await logTrade(cfg, { action: "SELL", status: "FAILED", reason: `manual close failed: ${msg}` });
      out.ok = false;
      out.results.push({ positionId: pos.id, price: null, pnlUsdt: null, error: msg });
    }
  }
  return out;
}

async function logTrade(
  cfg: TradeLogConfig,
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
