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
  fetchCandles,
  fetchCloses,
  fetchTickerPrice,
  fetchSpotProduct,
  placeSpotMarketOrder,
  placeSpotLimitOrderWithTpsl,
  cancelSpotOrder,
  fetchSpotBalance,
  fetchOcoPlanRows,
  cancelOcoPlan,
  fetchRecentFills,
  classifyOrderStatus,
  clipToPrecision,
  planLimitBuySize,
  fetchOrderFill,
  barsPerYearFor,
} from "./bitget-trade";
import { tfMsFor } from "./timeframes";
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
/** Paper maker-entry TTL: cancel/re-arm after this many bars of the TF. */
const ENTRY_TTL_BARS = 3;
/** A just-armed limit cannot fill off the SAME bar's earlier low. */
const ENTRY_MIN_AGE_MS = 60_000;

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
  /* Paper-wallet starting capital (USDT) — funds simulated entries. */
  paperCapitalUsdt: number | null;
  /* Paper maker-style entry: offset% below market + armed pending state. */
  entryOffsetPct: number | null;
  pendingEntryPrice: number | null;
  pendingEntrySize: number | null;
  pendingEntryAt: Date | null;
  /* Bitget-real: orderId of the armed LIVE post-only limit entry. */
  pendingEntryOrderId: string | null;
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

/** Minimal shape of an open position row the live exit paths rely on. */
interface OpenPositionRow {
  id: string;
  symbol: string;
  entryPrice: number;
  qty: number;
  sizeUsdt: number;
  paper: boolean;
  stopPrice: number;
  targetPrice: number;
  highestPrice: number | null;
  tpslArmed: boolean;
  openedAt: Date;
}

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

/**
 * Paper maker-entry helpers (design Task 15 — "jangan beli di harga market").
 *
 * A paper signal with entryOffsetPct > 0 no longer buys at the ticker. It
 * arms a pending LIMIT at `armLimitLevel()` — by construction BELOW the
 * market (post-only semantics) — and the level fills only when a candle
 * actually trades down through it (`limitFillPrice`), mirroring what a real
 * Bitget limit order on the bid side would experience. Pending state lives
 * on the BotConfig row (one armed order max, same as one position max).
 */

/** Paper maker-entry level: offset% BELOW the given price. */
export function armLimitLevel(price: number, offsetPct: number): number {
  return price * (1 - offsetPct / 100);
}

/**
 * Simulated fill for an armed limit: a gap THROUGH the level fills at the
 * open (better price), a plain touch fills exactly at the level. Caller has
 * already verified `low <= level`.
 */
export function limitFillPrice(open: number, low: number, level: number): number {
  return open <= level ? open : level;
}

/** Free paper wallet = capital + realized (closed) − open position size. */
async function paperWalletFree(cfg: { id: string; paperCapitalUsdt: number | null }): Promise<{ capital: number; free: number }> {
  const capital = cfg.paperCapitalUsdt && cfg.paperCapitalUsdt > 0 ? cfg.paperCapitalUsdt : 20;
  const [realizedAgg, openAgg] = await Promise.all([
    db.botPosition.aggregate({ where: { configId: cfg.id, status: "CLOSED", paper: true }, _sum: { realizedPnlUsdt: true } }),
    db.botPosition.aggregate({ where: { configId: cfg.id, status: "OPEN", paper: true }, _sum: { sizeUsdt: true } }),
  ]);
  return { capital, free: capital + (realizedAgg._sum.realizedPnlUsdt ?? 0) - (openAgg._sum.sizeUsdt ?? 0) };
}

/**
 * Lifecycle of an armed paper limit, evaluated once per tick (reached only
 * when NO position is open — the exit ladder returns earlier):
 *   1. bar low touched the level (order ≥60s old) → FILL at limitFillPrice,
 *      re-checking wallet + trade cap (they may have changed since arming);
 *   2. TTL (ENTRY_TTL_BARS × tf) elapsed → re-arm below the CURRENT price
 *      while the signal still holds, else cancel (free anti-buy-the-top
 *      filter: a level the market never revisits with a dead signal was not
 *      a good entry);
 *   3. otherwise keep waiting.
 */
async function limitEntryTick(
  cfg: BotConfigRow,
  signal: ReturnType<typeof computeBotSignal>,
  price: number,
  effSlPct: number,
  effTpPct: number,
  tf: string,
  entryOffset: number,
  minUsdt: number,
  maxTradesPerDay: number
): Promise<TickOutcome> {
  const base = { userId: cfg.userId, symbol: cfg.symbol, paper: true, score: signal.score };
  const level = cfg.pendingEntryPrice as number;
  const placedAt = cfg.pendingEntryAt?.getTime() ?? 0;
  const ttlMs = ENTRY_TTL_BARS * tfMsFor(tf);
  const clear = { pendingEntryPrice: null, pendingEntrySize: null, pendingEntryAt: null };
  const mode = (cfg.mode as BotMode) in MODE_PRESETS ? (cfg.mode as BotMode) : "MODERATE";

  /* Last bar OHLC — the fill probe. Unavailable → wait, never guess. */
  let bar: { open: number; low: number } | null = null;
  try {
    const bars = await fetchCandles(cfg.symbol, tf, 2, 1); // 2 bars is enough; minBars=1
    const last = bars[bars.length - 1];
    if (last && last.low > 0) bar = { open: last.open, low: last.low };
  } catch {
    /* probe unavailable this tick */
  }

  /* 1. Fill — the bar traded down through the armed level. */
  if (bar && placedAt > 0 && Date.now() - placedAt >= ENTRY_MIN_AGE_MS && bar.low <= level) {
    const fillPrice = limitFillPrice(bar.open, bar.low, level);
    const size = cfg.pendingEntrySize ?? 0;
    const { free } = await paperWalletFree(cfg);
    const minBuy = minUsdt > 0 ? minUsdt : FALLBACK_MIN_USDT;
    const todayCount = await db.botTrade.count({
      where: {
        configId: cfg.id,
        createdAt: { gte: utcDayStart() },
        action: { in: ["BUY", "SELL"] },
        status: { in: ["PAPER", "SUBMITTED"] },
        paper: true,
      },
    });
    if (size < minBuy || free < size || todayCount >= maxTradesPerDay) {
      await db.botConfig.update({ where: { id: cfg.id }, data: clear });
      return {
        ...base,
        action: "HOLD",
        reason: `limit cancelled @ ${level.toPrecision(6)} (wallet or trade-cap changed since arming)`,
      };
    }
    const qty = size / fillPrice;
    await db.botConfig.update({ where: { id: cfg.id }, data: clear });
    await db.botPosition.create({
      data: {
        userId: cfg.userId,
        configId: cfg.id,
        symbol: cfg.symbol,
        side: "LONG",
        entryPrice: fillPrice,
        qty,
        sizeUsdt: size,
        paper: true,
        stopPrice: fillPrice * (1 - effSlPct / 100),
        targetPrice: fillPrice * (1 + effTpPct / 100),
        highestPrice: fillPrice,
        status: "OPEN",
      },
    });
    const reason = `limit fill @ ${fillPrice.toPrecision(6)} (armed level ${level.toPrecision(6)})`;
    await logTrade(cfg, {
      action: "BUY",
      status: "PAPER",
      sizeUsdt: size,
      qty,
      price: fillPrice,
      reason,
      detail: detailJson(signal, { limitEntry: true, armedLevel: level }),
    });
    return { ...base, action: "BUY", reason };
  }

  /* 2. TTL — re-arm while the signal lives, cancel when it dies. */
  if (placedAt > 0 && Date.now() - placedAt >= ttlMs) {
    if (entryOffset > 0 && shouldEnter(signal, mode)) {
      const newLevel = armLimitLevel(price, entryOffset);
      await db.botConfig.update({
        where: { id: cfg.id },
        data: { pendingEntryPrice: newLevel, pendingEntryAt: new Date() },
      });
      return {
        ...base,
        action: "HOLD",
        reason: `limit re-armed @ ${newLevel.toPrecision(6)} (TTL ${ENTRY_TTL_BARS}×${tf} hit, score ${signal.score.toFixed(2)} still ≥ entry)`,
      };
    }
    await db.botConfig.update({ where: { id: cfg.id }, data: clear });
    return {
      ...base,
      action: "HOLD",
      reason: `limit expired after ${ENTRY_TTL_BARS}×${tf} — signal gone (score ${signal.score.toFixed(2)})`,
    };
  }

  /* 3. Still waiting. */
  const minsLeft = Math.max(0, Math.ceil((placedAt + ttlMs - Date.now()) / 60_000));
  return {
    ...base,
    action: "HOLD",
    reason: `waiting limit ${level.toPrecision(6)} (~${minsLeft}m to TTL, market ${price.toPrecision(6)})`,
  };
}

/** In-memory product-rules cache (exchange minimums rarely change). */
const productCache = new Map<string, { rules: { minOrderUsdt: number; quantityPrecision: number; pricePrecision: number }; at: number }>();
async function productRules(symbol: string): Promise<{ minOrderUsdt: number; quantityPrecision: number; pricePrecision: number }> {
  const hit = productCache.get(symbol);
  if (hit && Date.now() - hit.at < 6 * 3600_000) return hit.rules;
  try {
    const rules = await fetchSpotProduct(symbol);
    productCache.set(symbol, { rules, at: Date.now() });
    return rules;
  } catch {
    return { minOrderUsdt: FALLBACK_MIN_USDT, quantityPrecision: 8, pricePrecision: 8 };
  }
}

async function minOrderUsdt(symbol: string): Promise<number> {
  return (await productRules(symbol)).minOrderUsdt;
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

/* ------------------------------------------------------------------ */
/* Bitget-real (Task 16) — live order-limit + OCO machinery            */
/*                                                                     */
/* The live entry mirrors the paper maker-entry rule (Task 15) 1:1:    */
/*   signal → post-only LIMIT at ticker × (1 − offset%) with ATTACHED  */
/*   TP/SL (Bitget's spot OCO) → fill only when the market trades      */
/*   down into the level → TTL 3 bars → re-price while the signal      */
/*   holds, cancel when it dies.                                       */
/* The attached TP/SL is armed atomically by the exchange at fill —    */
/* there is never an unprotected window between entry and protection.  */
/* TP/SL exits belong to the exchange; the engine reconciles their     */
/* real fills. Engine-initiated exits (trail-stop, signal-flip, manual */
/* close) cancel the armed OCO plans FIRST so nothing can fire into    */
/* an already-closed position.                                         */
/* ------------------------------------------------------------------ */

type BitgetCreds = NonNullable<Awaited<ReturnType<typeof loadCreds>>>;

/** USDT actually available on the user's spot account (frozen excluded). */
async function liveFreeUsdt(creds: BitgetCreds): Promise<number | null> {
  try {
    const bal = await fetchSpotBalance(creds, "USDT");
    return bal ? bal.available : null;
  } catch {
    return null;
  }
}

/** Base coin of a spot pair ("LITUSDT" → "LIT"). */
function baseCoinOf(symbol: string): string {
  return symbol.replace(/USDT$/i, "") || symbol;
}

/**
 * Place the live post-only limit BUY with attached TP/SL and persist the
 * pending state. Returns the orderId. Throws on exchange rejection —
 * the caller logs the failure and the next tick re-evaluates from scratch.
 */
async function armLiveLimit(args: {
  cfg: BotConfigRow;
  creds: BitgetCreds;
  signal: ReturnType<typeof computeBotSignal>;
  marketPrice: number;
  effSlPct: number;
  effTpPct: number;
  minUsdt: number;
  quantityPrecision: number;
  pricePrecision: number;
  availableUsdt: number;
  walletNote?: string;
}): Promise<{ orderId: string; level: number; notional: number; qty: string }> {
  const { cfg, creds, signal, marketPrice, effSlPct, effTpPct, minUsdt, quantityPrecision, pricePrecision, availableUsdt } = args;
  const levelRaw = armLimitLevel(marketPrice, entryOffsetOf(cfg));
  const level = Number(clipToPrecision(levelRaw, pricePrecision)); // never round ABOVE the maker level
  if (!(level > 0) || level >= marketPrice) throw new Error("limit level not below market — skipped");

  const sizing = planLimitBuySize({
    marketPrice,
    level,
    budgetUsdt: cfg.orderSizeUsdt,
    minOrderUsdt: minUsdt,
    availableUsdt,
    quantityPrecision,
  });
  if (!sizing) throw new Error("budget below exchange minimum after precision clipping");

  // TP/SL triggers are computed from the LIMIT level (the actual entry),
  // so the bands hold regardless of where the fill happens.
  const tpStr = clipToPrecision(level * (1 + effTpPct / 100), pricePrecision);
  const slStr = clipToPrecision(level * (1 - effSlPct / 100), pricePrecision);

  const placed = await placeSpotLimitOrderWithTpsl(creds, {
    symbol: cfg.symbol,
    side: "buy",
    price: level.toPrecision(12).replace(/0+$/, "").replace(/\.$/, ""),
    size: sizing.qty,
    takeProfitTrigger: tpStr,
    stopLossTrigger: slStr,
  });

  await db.botConfig.update({
    where: { id: cfg.id },
    data: {
      pendingEntryPrice: level,
      pendingEntrySize: sizing.notional,
      pendingEntryAt: new Date(),
      pendingEntryOrderId: placed.orderId,
    },
  });
  await logTrade(cfg, {
    action: "HOLD",
    status: "SUBMITTED",
    sizeUsdt: sizing.notional,
    price: level,
    orderId: placed.orderId,
    clientOid: placed.clientOid,
    reason: `live limit armed @ ${level} (−${entryOffsetOf(cfg)}% vs market ${marketPrice.toPrecision(6)}), OCO TP ${tpStr} / SL ${slStr}, TTL ${ENTRY_TTL_BARS}×${cfg.timeframe ?? "4H"}${args.walletNote ?? ""}`,
    detail: detailJson(signal, { limitEntry: true, level, live: true, orderId: placed.orderId }),
  });
  return { orderId: placed.orderId, level, notional: sizing.notional, qty: sizing.qty };
}

/** Effective entry offset for a config (0..5, 0 = legacy market entry). */
function entryOffsetOf(cfg: Pick<BotConfigRow, "entryOffsetPct">): number {
  return cfg.entryOffsetPct != null && Number.isFinite(cfg.entryOffsetPct) && cfg.entryOffsetPct > 0
    ? Math.min(cfg.entryOffsetPct, 5)
    : 0;
}

/** Create the live position row after a confirmed entry fill. */
async function openLivePosition(args: {
  cfg: BotConfigRow;
  entryPrice: number;
  qty: number;
  sizeUsdt: number;
  effSlPct: number;
  effTpPct: number;
}): Promise<void> {
  const { cfg, entryPrice, qty, sizeUsdt, effSlPct, effTpPct } = args;
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
      tpslArmed: true, // attached OCO on the entry order protects this position
      status: "OPEN",
    },
  });
}

/**
 * Lifecycle of an armed LIVE limit, evaluated once per tick (reached only
 * when NO position is open — the exit ladder returns earlier):
 *   1. orderInfo FILLED → position + the exchange already armed the OCO;
 *   2. CANCELLED externally (user cancelled on Bitget) → clear, wait;
 *   3. TTL elapsed → cancel → race-check (may have filled mid-cancel) →
 *      re-price while the signal holds, else cancel (free anti-buy-the-top);
 *   4. otherwise keep waiting.
 */
async function livePendingEntryTick(
  cfg: BotConfigRow,
  creds: BitgetCreds,
  signal: ReturnType<typeof computeBotSignal>,
  price: number,
  effSlPct: number,
  effTpPct: number,
  minUsdt: number,
  quantityPrecision: number,
  pricePrecision: number,
  maxTradesPerDay: number
): Promise<TickOutcome> {
  const base = { userId: cfg.userId, symbol: cfg.symbol, paper: false, score: signal.score };
  const level = cfg.pendingEntryPrice as number;
  const orderId = cfg.pendingEntryOrderId as string;
  const placedAt = cfg.pendingEntryAt?.getTime() ?? 0;
  const ttlMs = ENTRY_TTL_BARS * tfMsFor(cfg.timeframe ?? "4H");
  const clear = { pendingEntryPrice: null, pendingEntrySize: null, pendingEntryAt: null, pendingEntryOrderId: null };
  const mode = (cfg.mode as BotMode) in MODE_PRESETS ? (cfg.mode as BotMode) : "MODERATE";

  const fill = await fetchOrderFill(creds, cfg.symbol, orderId);
  const state = classifyOrderStatus(fill.status);

  /* 1. Filled → open the position; OCO protection already lives on the exchange. */
  if (state === "FILLED") {
    const entryPrice = fill.priceAvg ?? level;
    const qty = fill.baseVolume ?? 0;
    if (qty <= 0 || entryPrice <= 0) {
      // fill info not usable — wait for a better read, never guess
      return { ...base, action: "HOLD", reason: `live limit filled but fill data incomplete (${fill.status}), retrying` };
    }
    const sizeUsdt = qty * entryPrice;
    await db.botConfig.update({ where: { id: cfg.id }, data: clear });
    await openLivePosition({ cfg, entryPrice, qty, sizeUsdt, effSlPct, effTpPct });
    const reason = `live limit filled @ ${entryPrice.toPrecision(6)} — OCO TP/SL armed by exchange`;
    await logTrade(cfg, {
      action: "BUY",
      status: "SUBMITTED",
      sizeUsdt,
      qty,
      price: entryPrice,
      orderId,
      reason,
      detail: detailJson(signal, { limitEntry: true, live: true, armedLevel: level }),
    });
    return { ...base, action: "BUY", reason };
  }

  /* 2. Cancelled outside the engine (user pressed cancel on Bitget). */
  if (state === "CANCELLED") {
    await db.botConfig.update({ where: { id: cfg.id }, data: clear });
    await logTrade(cfg, {
      action: "HOLD",
      status: "FAILED",
      reason: `live limit ${orderId} no longer on the book (cancelled/rejected) — pending cleared`,
    });
    return { ...base, action: "HOLD", reason: `live limit cancelled on exchange (was ${level.toPrecision(6)})` };
  }

  /* 3. TTL — cancel, then re-price or retire depending on the signal. */
  if (placedAt > 0 && Date.now() - placedAt >= ttlMs) {
    try {
      await cancelSpotOrder(creds, { symbol: cfg.symbol, orderId });
      // cancel raced with a fill? re-read the order once
      const after = await fetchOrderFill(creds, cfg.symbol, orderId);
      const afterState = classifyOrderStatus(after.status);
      if (afterState === "FILLED" && (after.baseVolume ?? 0) > 0) {
        const entryPrice = after.priceAvg ?? level;
        const qty = after.baseVolume as number;
        const sizeUsdt = qty * entryPrice;
        await db.botConfig.update({ where: { id: cfg.id }, data: clear });
        await openLivePosition({ cfg, entryPrice, qty, sizeUsdt, effSlPct, effTpPct });
        const reason = `live limit filled during TTL cancel @ ${entryPrice.toPrecision(6)} — OCO armed`;
        await logTrade(cfg, {
          action: "BUY",
          status: "SUBMITTED",
          sizeUsdt,
          qty,
          price: entryPrice,
          orderId,
          reason,
          detail: detailJson(signal, { limitEntry: true, live: true, armedLevel: level }),
        });
        return { ...base, action: "BUY", reason };
      }
    } catch {
      // cancel failed (network/exchange) — the order may still be live; wait a tick
      return { ...base, action: "HOLD", reason: `TTL hit but cancel failed — limit ${level.toPrecision(6)} left on the book, retry next tick` };
    }

    if (entryOffsetOf(cfg) > 0 && shouldEnter(signal, mode)) {
      try {
        const available = await liveFreeUsdt(creds);
        if (available == null) throw new Error("spot balance unavailable");
        const armed = await armLiveLimit({
          cfg,
          creds,
          signal,
          marketPrice: price,
          effSlPct,
          effTpPct,
          minUsdt,
          quantityPrecision,
          pricePrecision,
          availableUsdt: available,
          walletNote: " (re-priced after TTL)",
        });
        // level/orderId were refreshed by armLiveLimit
        return {
          ...base,
          action: "HOLD",
          reason: `limit re-priced @ ${armed.level} (TTL ${ENTRY_TTL_BARS}×${cfg.timeframe ?? "4H"} hit, score ${signal.score.toFixed(2)} still ≥ entry)`,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message.slice(0, 160) : "re-arm failed";
        await db.botConfig.update({ where: { id: cfg.id }, data: clear });
        await logTrade(cfg, { action: "HOLD", status: "FAILED", reason: `re-arm after TTL failed: ${msg}` });
        return { ...base, action: "HOLD", reason: `limit expired after TTL — re-arm failed (${msg})` };
      }
    }

    await db.botConfig.update({ where: { id: cfg.id }, data: clear });
    await logTrade(cfg, {
      action: "HOLD",
      status: "FAILED",
      reason: `live limit expired after ${ENTRY_TTL_BARS}×${cfg.timeframe ?? "4H"} — signal gone (score ${signal.score.toFixed(2)})`,
    });
    return {
      ...base,
      action: "HOLD",
      reason: `limit expired after ${ENTRY_TTL_BARS}×${cfg.timeframe ?? "4H"} — signal gone (score ${signal.score.toFixed(2)})`,
    };
  }

  /* 4. Still waiting. */
  const minsLeft = Math.max(0, Math.ceil((placedAt + ttlMs - Date.now()) / 60_000));
  return {
    ...base,
    action: "HOLD",
    reason: `waiting live limit ${level.toPrecision(6)} (~${minsLeft}m to TTL, market ${price.toPrecision(6)})`,
  };
}

/**
 * Cancel the armed OCO plan rows that protect a position (matched by sell
 * side and ≈ the position's size — attached TP/SL rows surface in
 * current-plan-order after the entry fills).
 */
async function cancelOcoPlansFor(creds: BitgetCreds, pos: OpenPositionRow): Promise<{ cancelled: number; failed: number }> {
  const rows = await fetchOcoPlanRows(creds, pos.symbol);
  const mine = rows.filter((r) => r.side === "sell" && r.size > 0 && Math.abs(r.size - pos.qty) / pos.qty <= 0.35);
  let cancelled = 0;
  let failed = 0;
  for (const row of mine) {
    try {
      await cancelOcoPlan(creds, row.orderId);
      cancelled += 1;
    } catch {
      failed += 1;
    }
  }
  return { cancelled, failed };
}

/** OrderIds this engine already sold with (never reconcile our own sells). */
async function engineSoldOrderIds(cfgId: string): Promise<Set<string>> {
  const rows = await db.botTrade.findMany({
    where: { configId: cfgId, action: "SELL", orderId: { not: null } },
    select: { orderId: true },
    take: 100,
  });
  return new Set(rows.map((r) => r.orderId as string).filter(Boolean));
}

/**
 * Reconcile an OCO-triggered exit with the exchange's real fill. The
 * position's TP/SL plans are gone from current-plan-order; the actual sell
 * fill appears in /fills. Returns null while the outcome is still unclear
 * (caller keeps the position open and retries next tick).
 */
async function findOcoExitFill(
  creds: BitgetCreds,
  cfg: TradeLogConfig,
  pos: OpenPositionRow
): Promise<{ price: number; qty: number } | null> {
  const [rows, sold] = await Promise.all([
    fetchRecentFills(creds, pos.symbol, pos.openedAt.getTime() - 60_000),
    engineSoldOrderIds(cfg.id),
  ]);
  const candidates = rows
    .filter((f) => f.side === "sell" && !sold.has(f.orderId))
    .filter((f) => Math.abs(f.size - pos.qty) / pos.qty <= 0.35)
    .sort((a, b) => b.ts - a.ts);
  const hit = candidates[0];
  return hit ? { price: hit.price, qty: hit.size } : null;
}

/**
 * Base-coin balance clamp for live SELLs: buy fees are charged in the
 * received coin, so pos.qty can exceed the actual balance by the fee.
 * Selling more than owned fails — always sell the smaller amount.
 */
async function liveSellQty(creds: BitgetCreds, pos: OpenPositionRow): Promise<string> {
  let available = pos.qty;
  try {
    const bal = await fetchSpotBalance(creds, baseCoinOf(pos.symbol));
    if (bal && bal.available > 0) available = Math.min(available, bal.available);
  } catch {
    /* balance read failed — fall back to the position qty */
  }
  return clipToPrecision(available, 8);
}

/**
 * Engine-initiated live exit: cancel the armed OCO FIRST (fail → keep the
 * position: protection intact beats a manual exit), then market-sell the
 * balance-clamped quantity and close with the real fill.
 */
async function liveEngineExit(
  cfg: BotConfigRow,
  creds: BitgetCreds,
  pos: OpenPositionRow,
  signal: ReturnType<typeof computeBotSignal>,
  fallbackPrice: number,
  exitReason: string,
  exitKind: string
): Promise<TickOutcome> {
  const base = { userId: cfg.userId, symbol: cfg.symbol, paper: false, score: signal.score };
  const oco = await cancelOcoPlansFor(creds, pos);
  if (oco.failed > 0) {
    return {
      ...base,
      action: "HOLD",
      reason: `${exitKind} skipped — OCO cancel failed (${oco.failed}); protection kept, retry next tick`,
    };
  }
  try {
    const qtyStr = await liveSellQty(creds, pos);
    if (!qtyStr || Number(qtyStr) <= 0) {
      // nothing to sell — the OCO probably fired already; reconcile instead
      const fill = await findOcoExitFill(creds, cfg, pos);
      if (fill) {
        const pnl = ((fill.price - pos.entryPrice) / pos.entryPrice) * pos.sizeUsdt;
        await closePosition(pos.id, fill.price, pnl, `${exitReason} (reconciled from OCO fill)`);
        await logTrade(cfg, {
          action: "SELL",
          status: "SUBMITTED",
          sizeUsdt: pos.sizeUsdt,
          qty: fill.qty,
          price: fill.price,
          reason: `${exitReason} (OCO fill reconciled)`,
          pnlUsdt: pnl,
          detail: detailJson(signal, { exit: exitKind, reconciled: true }),
        });
        return { ...base, action: "SELL", reason: `${exitReason} (OCO fill reconciled)`, pnlUsdt: pnl };
      }
      return { ...base, action: "HOLD", reason: `${exitKind} skipped — no sellable balance and no OCO fill found yet` };
    }
    const placed = await placeSpotMarketOrder(creds, { symbol: cfg.symbol, side: "sell", quantity: qtyStr });
    const fill = await fetchOrderFill(creds, cfg.symbol, placed.orderId);
    const exitPrice = fill.priceAvg ?? fallbackPrice;
    const exitQty = fill.baseVolume ?? Number(qtyStr);
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
      detail: detailJson(signal, { exit: exitKind, ocoCancelled: oco.cancelled, fillStatus: fill.status }),
    });
    return { ...base, action: "SELL", reason: exitReason, pnlUsdt: livePnl };
  } catch (err) {
    const msg = err instanceof Error ? err.message.slice(0, 160) : "sell failed";
    await logTrade(cfg, { action: "SELL", status: "FAILED", reason: `${exitKind} sell failed: ${msg}`, detail: detailJson(signal, { exit: exitKind }) });
    return { ...base, action: "ERROR", reason: `${exitKind} sell failed: ${msg}` };
  }
}

/**
 * Exchange-owned exit (TP or the original SL) for an OCO-armed position:
 * the price crossed the band, so either the trigger is pending or it just
 * fired. NEVER market-sell here — the exchange will do it; selling too
 * would oversell. Reconcile the real fill instead.
 */
async function liveOcoReconcile(
  cfg: BotConfigRow,
  creds: BitgetCreds,
  pos: OpenPositionRow,
  signal: ReturnType<typeof computeBotSignal>,
  price: number,
  exitReason: string,
  exitKind: string
): Promise<TickOutcome> {
  const base = { userId: cfg.userId, symbol: cfg.symbol, paper: false, score: signal.score };
  const rows = await fetchOcoPlanRows(creds, pos.symbol);
  const stillArmed = rows.some((r) => r.side === "sell" && r.size > 0 && Math.abs(r.size - pos.qty) / pos.qty <= 0.35);
  if (stillArmed) {
    return {
      ...base,
      action: "HOLD",
      reason: `${exitKind} crossed (${exitReason}) — OCO trigger pending on exchange, waiting for the exchange exit`,
    };
  }
  const fill = await findOcoExitFill(creds, cfg, pos);
  if (!fill) {
    return {
      ...base,
      action: "HOLD",
      reason: `${exitKind} crossed but OCO fill not visible yet — position kept, reconcile retries next tick`,
    };
  }
  const pnl = ((fill.price - pos.entryPrice) / pos.entryPrice) * pos.sizeUsdt;
  await closePosition(pos.id, fill.price, pnl, `${exitReason} (via OCO)`);
  await logTrade(cfg, {
    action: "SELL",
    status: "SUBMITTED",
    sizeUsdt: pos.sizeUsdt,
    qty: fill.qty,
    price: fill.price,
    reason: `${exitReason} (via OCO)`,
    pnlUsdt: pnl,
    detail: detailJson(signal, { exit: exitKind, oco: true }),
  });
  return { ...base, action: "SELL", reason: `${exitReason} (via OCO)`, pnlUsdt: pnl };
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
  /* Maker-entry offset (Task 15 paper / Task 16 live): >0 = arm limits
     BELOW market; 0 = legacy market BUY. Live runs the SAME rule as paper —
     a real post-only limit with attached TP/SL (OCO). */
  const entryOffset = entryOffsetOf(cfg);
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
  const rules = await productRules(cfg.symbol);
  const minUsdt = rules.minOrderUsdt;
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
    /* live exits — OCO-aware routing (Task 16):
       · take-profit / original stop-loss on an OCO-armed position belong to
         the EXCHANGE — reconcile its real fill, never double-sell;
       · trail-stop and signal-flip are engine-initiated: cancel the armed
         OCO first, then market-sell (protection kept if cancel fails);
       · legacy positions without OCO behave exactly as before. */
    if (pos.tpslArmed && (exit === "take-profit" || (exit === "stop-loss" && !isTrail))) {
      const out = await liveOcoReconcile(cfg, creds!, pos, signal, price, exitReason, exitKind);
      await touchConfig(cfg.id, price);
      return out;
    }
    const out = await liveEngineExit(cfg, creds!, pos, signal, price, exitReason, exitKind);
    await touchConfig(cfg.id, price);
    return out;
  }

  /* ---- 1b. Paper limit-entry lifecycle (fill / TTL re-arm / waiting).
     Only reached with NO open position — the exit ladder returned earlier. ---- */
  if (cfg.paper && cfg.pendingEntryPrice != null && cfg.pendingEntryPrice > 0) {
    if (entryOffset <= 0) {
      /* user turned the offset off → cancel the armed limit, never fill it */
      await db.botConfig.update({
        where: { id: cfg.id },
        data: { pendingEntryPrice: null, pendingEntrySize: null, pendingEntryAt: null },
      });
      await touchConfig(cfg.id, price);
      return {
        userId: cfg.userId,
        symbol: cfg.symbol,
        paper: true,
        action: "HOLD",
        reason: "limit cancelled (entry offset set to 0)",
        score: signal.score,
      };
    }
    const out = await limitEntryTick(cfg, signal, price, effSlPct, effTpPct, tf, entryOffset, minUsdt, preset.maxTradesPerDay);
    await touchConfig(cfg.id, price);
    return out;
  }

  /* ---- 1c. LIVE limit-entry lifecycle (Bitget-real, Task 16) — the same
     maker-entry rule as paper, executed with a real post-only order that
     carries its own OCO. An armed live order must always have an orderId;
     a level without one is stale state (pre-Task-16 or a crashed placement)
     and is dropped before anything else can happen. ---- */
  if (!cfg.paper && (cfg.pendingEntryOrderId || (cfg.pendingEntryPrice != null && cfg.pendingEntryPrice > 0))) {
    if (!cfg.pendingEntryOrderId) {
      await db.botConfig.update({
        where: { id: cfg.id },
        data: { pendingEntryPrice: null, pendingEntrySize: null, pendingEntryAt: null, pendingEntryOrderId: null },
      });
      await touchConfig(cfg.id, price);
      return {
        userId: cfg.userId,
        symbol: cfg.symbol,
        paper: false,
        action: "HOLD",
        reason: "stale pending limit without orderId cleared",
        score: signal.score,
      };
    }
    if (entryOffset <= 0) {
      /* user turned the offset off → cancel the real order on the exchange */
      try {
        await cancelSpotOrder(creds!, { symbol: cfg.symbol, orderId: cfg.pendingEntryOrderId });
      } catch {
        /* cancel raced a fill or already gone — orderInfo next tick settles it */
      }
      await touchConfig(cfg.id, price);
      return {
        userId: cfg.userId,
        symbol: cfg.symbol,
        paper: false,
        action: "HOLD",
        reason: "live limit cancel requested (entry offset set to 0) — verifying next tick",
        score: signal.score,
      };
    }
    const out = await livePendingEntryTick(cfg, creds!, signal, price, effSlPct, effTpPct, minUsdt, rules.quantityPrecision, rules.pricePrecision, preset.maxTradesPerDay);
    await touchConfig(cfg.id, price);
    return out;
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
    /* Paper wallet: entries are funded from capital + realized PnL − open
       size. Free below the order size → clamp down to the free balance when
       it still clears the exchange minimum, otherwise skip this tick. */
    const { capital, free } = await paperWalletFree(cfg);
    let paperSize = sizeUsdt;
    let walletNote = "";
    const minBuy = minUsdt > 0 ? minUsdt : FALLBACK_MIN_USDT;
    if (free < paperSize) {
      if (free >= minBuy) {
        paperSize = Math.floor(free * 100) / 100; // round down to whole cents
        walletNote = ` (clamped to free wallet ${free.toFixed(2)})`;
      } else {
        await touchConfig(cfg.id, price);
        return {
          userId: cfg.userId,
          symbol: cfg.symbol,
          paper: true,
          action: "HOLD",
          reason: `paper wallet full — free ${free.toFixed(2)} of ${capital.toFixed(2)} USDT`,
          score: signal.score,
        };
      }
    }

    /* ---- maker-style entry (offset > 0): arm a limit BELOW the market and
       WAIT — the fill happens on a later tick when a bar trades down through
       the level. Level < ticker by construction, so this can never buy at
       the market price (post-only semantics). ---- */
    if (entryOffset > 0) {
      const level = armLimitLevel(price, entryOffset);
      await db.botConfig.update({
        where: { id: cfg.id },
        data: { pendingEntryPrice: level, pendingEntrySize: paperSize, pendingEntryAt: new Date() },
      });
      const reason = `limit armed @ ${level.toPrecision(6)} (−${entryOffset}% vs market ${price.toPrecision(6)}), TTL ${ENTRY_TTL_BARS}×${tf}${walletNote}`;
      await logTrade(cfg, {
        action: "HOLD",
        status: "PAPER",
        sizeUsdt: paperSize,
        reason,
        detail: detailJson(signal, { limitEntry: true, level }),
      });
      await touchConfig(cfg.id, price);
      return { userId: cfg.userId, symbol: cfg.symbol, paper: true, action: "HOLD", reason, score: signal.score };
    }

    /* offset 0 → legacy market BUY; drop any stale pending limit first */
    if (cfg.pendingEntryPrice != null || cfg.pendingEntrySize != null || cfg.pendingEntryAt) {
      await db.botConfig.update({
        where: { id: cfg.id },
        data: { pendingEntryPrice: null, pendingEntrySize: null, pendingEntryAt: null },
      });
    }

    const qty = paperSize / price;
    await db.botPosition.create({
      data: {
        userId: cfg.userId,
        configId: cfg.id,
        symbol: cfg.symbol,
        side: "LONG",
        entryPrice: price,
        qty,
        sizeUsdt: paperSize,
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
      sizeUsdt: paperSize,
      qty,
      price,
      reason: `${entryReason}${walletNote}`,
      detail: detailJson(signal),
    });
    await touchConfig(cfg.id, price);
    return { userId: cfg.userId, symbol: cfg.symbol, paper: true, action: "BUY", reason: `${entryReason}${walletNote}`, score: signal.score };
  }

  /* ---- LIVE entry (Bitget-real, Task 16) ----
     offset > 0: funding is the REAL spot USDT balance; the order is a
     post-only limit below the market with ATTACHED TP/SL (true OCO armed
     atomically at fill). offset = 0: legacy market BUY, but it also carries
     the attached TP/SL so no live position is ever unprotected. */
  const available = await liveFreeUsdt(creds!);
  if (available == null) {
    await touchConfig(cfg.id, price);
    return { userId: cfg.userId, symbol: cfg.symbol, paper: false, action: "HOLD", reason: "spot USDT balance unavailable — entry skipped this tick", score: signal.score };
  }
  const minBuy = minUsdt > 0 ? minUsdt : FALLBACK_MIN_USDT;

  if (entryOffset > 0) {
    if (available < Math.max(cfg.orderSizeUsdt, minBuy)) {
      await touchConfig(cfg.id, price);
      return {
        userId: cfg.userId,
        symbol: cfg.symbol,
        paper: false,
        action: "HOLD",
        reason: `insufficient spot USDT — available ${available.toFixed(2)} < order ${Math.max(cfg.orderSizeUsdt, minBuy).toFixed(2)}`,
        score: signal.score,
      };
    }
    try {
      const armed = await armLiveLimit({
        cfg,
        creds: creds!,
        signal,
        marketPrice: price,
        effSlPct,
        effTpPct,
        minUsdt,
        quantityPrecision: rules.quantityPrecision,
        pricePrecision: rules.pricePrecision,
        availableUsdt: available,
      });
      await touchConfig(cfg.id, price);
      return {
        userId: cfg.userId,
        symbol: cfg.symbol,
        paper: false,
        action: "HOLD",
        reason: `live limit armed @ ${armed.level} (−${entryOffset}% vs market, OCO TP/SL preset), TTL ${ENTRY_TTL_BARS}×${tf}`,
        score: signal.score,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message.slice(0, 160) : "limit placement failed";
      await logTrade(cfg, { action: "HOLD", status: "FAILED", sizeUsdt: cfg.orderSizeUsdt, reason: `live limit arm failed: ${msg}`, detail: detailJson(signal) });
      await touchConfig(cfg.id, price);
      return { userId: cfg.userId, symbol: cfg.symbol, paper: false, action: "ERROR", reason: msg };
    }
  }

  /* offset 0 → market BUY with attached TP/SL; drop any stale pending limit first */
  if (cfg.pendingEntryPrice != null || cfg.pendingEntrySize != null || cfg.pendingEntryAt || cfg.pendingEntryOrderId) {
    await db.botConfig.update({
      where: { id: cfg.id },
      data: { pendingEntryPrice: null, pendingEntrySize: null, pendingEntryAt: null, pendingEntryOrderId: null },
    });
  }
  if (available < sizeUsdt) {
    await touchConfig(cfg.id, price);
    return {
      userId: cfg.userId,
      symbol: cfg.symbol,
      paper: false,
      action: "HOLD",
      reason: `insufficient spot USDT — available ${available.toFixed(2)} < order ${sizeUsdt.toFixed(2)}`,
      score: signal.score,
    };
  }
  try {
    const tpStr = clipToPrecision(price * (1 + effTpPct / 100), rules.pricePrecision);
    const slStr = clipToPrecision(price * (1 - effSlPct / 100), rules.pricePrecision);
    const placed = await placeSpotMarketOrder(creds!, {
      symbol: cfg.symbol,
      side: "buy",
      quantity: sizeUsdt.toFixed(2),
      takeProfitTrigger: tpStr,
      stopLossTrigger: slStr,
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
        tpslArmed: true,
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
      reason: `${entryReason} — OCO TP ${tpStr} / SL ${slStr}`,
      detail: detailJson(signal, { fillStatus: fill.status, oco: true }),
    });
    await touchConfig(cfg.id, price);
    return { userId: cfg.userId, symbol: cfg.symbol, paper: false, action: "BUY", reason: `${entryReason} — OCO TP/SL armed`, score: signal.score };
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
    /* live SELL — OCO-aware (Task 16): cancel armed TP/SL plans FIRST (a
       failing cancel keeps the position — protection intact), then sell the
       balance-clamped quantity; if the OCO already exited on the exchange,
       reconcile the real fill instead of selling nothing. */
    try {
      if (pos.tpslArmed) {
        const oco = await cancelOcoPlansFor(creds!, pos);
        if (oco.failed > 0) {
          const emsg = `manual close aborted — OCO cancel failed (${oco.failed}); protection kept`;
          await logTrade(cfg, { action: "SELL", status: "FAILED", reason: emsg });
          out.ok = false;
          out.results.push({ positionId: pos.id, price: null, pnlUsdt: null, error: emsg });
          continue;
        }
      }
      const qtyStr = await liveSellQty(creds!, pos);
      if (!qtyStr || Number(qtyStr) <= 0) {
        const fill = await findOcoExitFill(creds!, cfg, pos);
        if (fill) {
          const livePnl = ((fill.price - pos.entryPrice) / pos.entryPrice) * pos.sizeUsdt;
          await closePosition(pos.id, fill.price, livePnl, `${reason} (OCO fill reconciled)`);
          await logTrade(cfg, {
            action: "SELL",
            status: "SUBMITTED",
            sizeUsdt: pos.sizeUsdt,
            qty: fill.qty,
            price: fill.price,
            reason: `${reason} (OCO fill reconciled)`,
            pnlUsdt: livePnl,
            detail: JSON.stringify({ manual: true, reconciled: true }),
          });
          out.closed += 1;
          out.results.push({ positionId: pos.id, price: fill.price, pnlUsdt: livePnl });
          continue;
        }
        const emsg = "manual close skipped — no sellable base balance and no OCO fill found";
        await logTrade(cfg, { action: "SELL", status: "FAILED", reason: emsg });
        out.ok = false;
        out.results.push({ positionId: pos.id, price: null, pnlUsdt: null, error: emsg });
        continue;
      }
      const placed = await placeSpotMarketOrder(creds!, { symbol: cfg.symbol, side: "sell", quantity: qtyStr });
      const fill = await fetchOrderFill(creds!, cfg.symbol, placed.orderId);
      const exitPrice = fill.priceAvg ?? ticker ?? pos.entryPrice;
      const exitQty = fill.baseVolume ?? Number(qtyStr);
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
