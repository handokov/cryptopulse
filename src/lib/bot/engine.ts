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
/** Fallback minimum when the exchange rules cannot be fetched.
 *  Bitget spot minimum verified live 2026-09: 1 USDT (user-corrected, was 5). */
const FALLBACK_MIN_USDT = 1;
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
  entryFeeUsdt: number | null;
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
async function liveFreeUsdt(creds: BitgetCreds): Promise<{ available: number | null; error?: string }> {
  try {
    const bal = await fetchSpotBalance(creds, "USDT");
    return { available: bal ? bal.available : null, error: bal ? undefined : "empty balance payload" };
  } catch (err) {
    /* Was silently swallowed — a broken Bitget connection then looked like an
       ordinary HOLD forever. Surface the reason (e.g. "bitget HTTP 401 [...]"). */
    return { available: null, error: err instanceof Error ? err.message.slice(0, 160) : "unknown balance error" };
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
  /* Patch K — the pending-slot state this caller expects, claimed atomically
     BEFORE the order goes to the exchange: null = fresh entry (slot must be
     empty); an orderId = TTL re-arm replacing the order just cancelled. */
  expectPendingOrderId?: string | null;
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

  /* Patch K — atomic claim of the pending slot BEFORE the exchange call.
     Two concurrent ticks (cron + page heartbeat, or a manual run mid-cron)
     used to place TWO real orders at the same level, and the second
     pendingEntryOrderId write orphaned the first order on the book — untracked
     real money. The conditional update is a compare-and-swap: exactly one
     claimer proceeds; the loser throws without ever touching Bitget. */
  const slot = await db.botConfig.updateMany({
    where: {
      id: cfg.id,
      pendingEntryOrderId: args.expectPendingOrderId ?? null,
    },
    data: {
      pendingEntryPrice: level,
      pendingEntrySize: sizing.notional,
      pendingEntryAt: new Date(),
    },
  });
  if (slot.count === 0) {
    throw new Error("entry slot busy — another tick is arming an order for this bot");
  }

  let placed: Awaited<ReturnType<typeof placeSpotLimitOrderWithTpsl>>;
  try {
    placed = await placeSpotLimitOrderWithTpsl(creds, {
      symbol: cfg.symbol,
      side: "buy",
      price: level.toPrecision(12).replace(/0+$/, "").replace(/\.$/, ""),
      size: sizing.qty,
      takeProfitTrigger: tpStr,
      stopLossTrigger: slStr,
    });
  } catch (err) {
    /* Patch K — release the slot we claimed: the order never went out, so
       the next tick must be free to arm again. */
    await db.botConfig
      .update({
        where: { id: cfg.id },
        data: { pendingEntryPrice: null, pendingEntrySize: null, pendingEntryAt: null, pendingEntryOrderId: null },
      })
      .catch(() => {});
    throw err;
  }

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

/**
 * Create the live position row after a confirmed entry fill.
 * Patch K — the UNIQUE(entryOrderId) index is the fill mutex: a fill
 * reconciled by two concurrent ticks races this create and exactly one wins;
 * the loser gets P2002 and must not log a second BUY. Returns false when the
 * position already exists (created by the concurrent twin).
 */
async function openLivePosition(args: {
  cfg: BotConfigRow;
  entryPrice: number;
  qty: number;
  sizeUsdt: number;
  effSlPct: number;
  effTpPct: number;
  orderId: string;
  entryFeeUsdt?: number;
}): Promise<boolean> {
  const { cfg, entryPrice, qty, sizeUsdt, effSlPct, effTpPct, orderId } = args;
  try {
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
        entryOrderId: orderId,
        entryFeeUsdt: args.entryFeeUsdt != null && args.entryFeeUsdt > 0 ? args.entryFeeUsdt : null,
        status: "OPEN",
      },
    });
    return true;
  } catch (err) {
    if ((err as { code?: string })?.code === "P2002") return false;
    throw err;
  }
}

/**
 * Patch I — conclusive entry-fill detection for an armed LIVE limit.
 * orderInfo can be blind exactly when it matters most: a transient API error
 * is swallowed into status "unknown", an empty row reads the same, and a
 * cancel can race a fill — the engine then says "keep waiting" forever while
 * the exchange already bought (and on a fast token, already TP-sold). The
 * fills record is the ground truth: look up OUR orderId there before ever
 * believing "still waiting".
 */
async function detectLiveEntryFill(
  creds: BitgetCreds,
  symbol: string,
  orderId: string,
  placedAtMs: number,
  info?: Awaited<ReturnType<typeof fetchOrderFill>>
): Promise<{ price: number; qty: number; feeUsdt: number; source: "orderInfo" | "fills" } | null> {
  if (
    info &&
    classifyOrderStatus(info.status) === "FILLED" &&
    (info.baseVolume ?? 0) > 0 &&
    (info.priceAvg ?? 0) > 0
  ) {
    return {
      price: info.priceAvg as number,
      qty: info.baseVolume as number,
      feeUsdt: feeToUsdt(info.fee, info.feeCoin, info.priceAvg),
      source: "orderInfo",
    };
  }
  const rows = await fetchRecentFills(creds, symbol, Math.max(0, placedAtMs - 60_000));
  const mine = rows.filter((f) => f.orderId === orderId && f.side === "buy");
  if (mine.length === 0) return null;
  const qty = mine.reduce((a, f) => a + f.size, 0);
  const quote = mine.reduce((a, f) => a + f.price * f.size, 0);
  const feeUsdt = mine.reduce((a, f) => a + feeToUsdt(f.fee, f.feeCoin, f.price), 0);
  return qty > 0 && quote > 0 ? { price: quote / qty, qty, feeUsdt, source: "fills" } : null;
}

/**
 * Patch I — open the position for a detected (possibly late) entry fill and,
 * within the SAME tick, check whether the exchange OCO already exited: on a
 * fast token the whole entry→TP arc can complete between two of our ticks,
 * so "position opened" and "position closed by the exchange" must be able to
 * land in one pass. Clears the pending state first; the BUY row always lands
 * in the audit trail; a same-tick OCO exit adds its SELL row on top.
 */
async function openLivePositionAndReconcileExit(args: {
  cfg: BotConfigRow;
  creds: BitgetCreds;
  signal: ReturnType<typeof computeBotSignal>;
  price: number;
  entryPrice: number;
  qty: number;
  effSlPct: number;
  effTpPct: number;
  orderId: string;
  entryReason: string;
  entryDetail: Record<string, unknown>;
  entryFeeUsdt?: number;
}): Promise<TickOutcome> {
  const { cfg, creds, signal, price, entryPrice, qty, effSlPct, effTpPct, orderId, entryReason, entryDetail } = args;
  const sizeUsdt = qty * entryPrice;
  /* Patch K — create FIRST: the entryOrderId unique index is the mutex, so a
     concurrent tick reconciling the same fill can never open a second row.
     Pending state is cleared only after we know we own the fill. */
  const opened = await openLivePosition({ cfg, entryPrice, qty, sizeUsdt, effSlPct, effTpPct, orderId, entryFeeUsdt: args.entryFeeUsdt });
  if (!opened) {
    return {
      userId: cfg.userId,
      symbol: cfg.symbol,
      paper: false,
      action: "BUY",
      reason: `${entryReason} — already reconciled by a concurrent tick`,
      score: signal.score,
    };
  }
  await db.botConfig.update({
    where: { id: cfg.id },
    data: { pendingEntryPrice: null, pendingEntrySize: null, pendingEntryAt: null, pendingEntryOrderId: null },
  });
  await logTrade(cfg, {
    action: "BUY",
    status: "SUBMITTED",
    sizeUsdt,
    qty,
    price: entryPrice,
    orderId,
    reason: entryReason,
    detail: detailJson(signal, entryDetail),
  });
  const pos = await db.botPosition.findFirst({
    where: { configId: cfg.id, status: "OPEN", paper: false },
    orderBy: { openedAt: "desc" },
  });
  if (!pos) {
    return { userId: cfg.userId, symbol: cfg.symbol, paper: false, action: "BUY", reason: entryReason, score: signal.score };
  }
  const exitOutcome = await liveOcoReconcile(
    cfg,
    creds,
    pos,
    signal,
    price,
    "exchange OCO after late-reconciled entry",
    "tp-or-sl"
  );
  if (exitOutcome.action === "SELL") return exitOutcome;
  return { userId: cfg.userId, symbol: cfg.symbol, paper: false, action: "BUY", reason: entryReason, score: signal.score };
}

/**
 * Lifecycle of an armed LIVE limit, evaluated once per tick (reached only
 * when NO position is open — the exit ladder returns earlier):
 *   1. FILLED (orderInfo, else Patch I fills ground truth) → position + the
 *      exchange already armed the OCO; if the OCO already exited too, the
 *      same tick closes the position with the real sell fill;
 *   2. CANCELLED externally (user cancelled on Bitget) → fill-race checked
 *      via fills, then clear, wait;
 *   3. TTL elapsed → cancel → race-check (may have filled mid-cancel; a
 *      FAILED cancel is itself a filled-order symptom — Patch I) →
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

  /* Patch I — one conclusive detection pass: orderInfo FILLED wins with its
     exact numbers; every other state (UNKNOWN from swallowed API errors,
     stale reads, CANCELLED that raced a fill) is cross-checked against the
     real fills record by orderId. "Still waiting" may only be believed when
     neither source shows a fill. PARTIAL stays on the TTL path: the order
     is still live and cancel/re-arm handles the remaining size. */
  const detected =
    state === "PARTIAL"
      ? null
      : await detectLiveEntryFill(creds, cfg.symbol, orderId, placedAt, fill).catch(() => null);

  /* 1. Filled → open the position; OCO protection already lives on the
        exchange. Patch I: if the OCO already exited too (fast token — the
        whole entry→TP arc between two ticks), close it in the same pass. */
  if (detected && detected.qty > 0 && detected.price > 0) {
    return openLivePositionAndReconcileExit({
      cfg,
      creds,
      signal,
      price,
      entryPrice: detected.price,
      qty: detected.qty,
      effSlPct,
      effTpPct,
      orderId,
      entryReason: `live limit filled @ ${detected.price.toPrecision(6)} — OCO TP/SL armed by exchange (fill via ${detected.source})`,
      entryDetail: { limitEntry: true, live: true, armedLevel: level, fillSource: detected.source },
      entryFeeUsdt: detected.feeUsdt,
    });
  }

  /* 1b. Status positively says filled but no usable numbers anywhere —
         never guess the entry; wait for a better read. */
  if (state === "FILLED") {
    return { ...base, action: "HOLD", reason: `live limit filled but fill data incomplete (${fill.status}), retrying` };
  }

  /* 2. Cancelled outside the engine (user pressed cancel on Bitget) — with
        no fill hiding underneath (checked above via the fills record). */
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
      // cancel raced with a fill? Patch I: conclusive detection (orderInfo +
      // fills ground truth), then open + same-tick OCO reconcile
      const after = await fetchOrderFill(creds, cfg.symbol, orderId);
      const raced = await detectLiveEntryFill(creds, cfg.symbol, orderId, placedAt, after).catch(() => null);
      if (raced && raced.qty > 0 && raced.price > 0) {
        return openLivePositionAndReconcileExit({
          cfg,
          creds,
          signal,
          price,
          entryPrice: raced.price,
          qty: raced.qty,
          effSlPct,
          effTpPct,
          orderId,
          entryReason: `live limit filled during TTL cancel @ ${raced.price.toPrecision(6)} — OCO armed (fill via ${raced.source})`,
          entryDetail: { limitEntry: true, live: true, armedLevel: level, fillSource: raced.source, raced: "ttl-cancel" },
          entryFeeUsdt: raced.feeUsdt,
        });
      }
    } catch {
      /* Patch I: cancelling an ALREADY-FILLED order is itself an error —
         this catch is exactly where a fill hides. Detect before "retry next
         tick" or the pending state deadlocks here forever. */
      const after = await fetchOrderFill(creds, cfg.symbol, orderId).catch(() => ({
        status: "unknown",
        priceAvg: null,
        baseVolume: null,
        fee: null,
        feeCoin: null,
      }));
      const raced = await detectLiveEntryFill(creds, cfg.symbol, orderId, placedAt, after).catch(() => null);
      if (raced && raced.qty > 0 && raced.price > 0) {
        return openLivePositionAndReconcileExit({
          cfg,
          creds,
          signal,
          price,
          entryPrice: raced.price,
          qty: raced.qty,
          effSlPct,
          effTpPct,
          orderId,
          entryReason: `live limit filled during TTL cancel @ ${raced.price.toPrecision(6)} — OCO armed (fill via ${raced.source})`,
          entryDetail: { limitEntry: true, live: true, armedLevel: level, fillSource: raced.source, raced: "ttl-cancel-failed" },
        });
      }
      // cancel failed (network/exchange) — the order may still be live; wait a tick
      return { ...base, action: "HOLD", reason: `TTL hit but cancel failed — limit ${level.toPrecision(6)} left on the book, retry next tick` };
    }

    if (entryOffsetOf(cfg) > 0 && shouldEnter(signal, mode)) {
      try {
        const { available, error: balErr } = await liveFreeUsdt(creds);
        if (available == null) throw new Error(`spot balance unavailable${balErr ? `: ${balErr}` : ""}`);
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
          expectPendingOrderId: orderId, // Patch K — re-arm replaces OUR cancelled order
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
  /* Patch Q — a failed plan-order read counts as a FAILED cancel: the caller
     then HOLDs ("protection kept, retry next tick") instead of market-selling
     while the OCO might still be armed. (The old []-swallow made a read
     failure look like "nothing to cancel".) */
  const rows = await fetchOcoPlanRows(creds, pos.symbol).catch(() => null);
  if (rows === null) return { cancelled: 0, failed: 1 };
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
): Promise<{ price: number; qty: number; feeUsdt: number } | null> {
  const [rows, sold] = await Promise.all([
    fetchRecentFills(creds, pos.symbol, pos.openedAt.getTime() - 60_000),
    engineSoldOrderIds(cfg.id),
  ]);
  const candidates = rows
    .filter((f) => f.side === "sell" && !sold.has(f.orderId))
    .filter((f) => Math.abs(f.size - pos.qty) / pos.qty <= 0.35)
    .sort((a, b) => b.ts - a.ts);
  const hit = candidates[0];
  return hit ? { price: hit.price, qty: hit.size, feeUsdt: feeToUsdt(hit.fee, hit.feeCoin, hit.price) } : null;
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
    /* Patch G: when the exchange ANSWERS with the coin row, trust it — clamp
       even to 0. Right after an OCO cancel Bitget may still report the coins
       frozen (available 0); the old code skipped the clamp on 0 and sold the
       full position qty blind, which Bitget rejects with 43012 Insufficient
       balance every tick. Returning "0" routes both callers to their
       reconcile/wait branch instead. Fall back to pos.qty only when the read
       itself fails or the coin row is absent (null). */
    if (bal) available = Math.min(available, Math.max(bal.available, 0));
  } catch {
    /* balance read failed — fall back to the position qty */
  }
  return clipToPrecision(available, 8);
}

/**
 * Patch L — OCO guardianship probe: is a TP/SL sell leg still armed on the
 * exchange for this position's size? A read failure counts as ARMED —
 * never cancel protection on a blind guess.
 */
async function ocoSellLegArmed(creds: BitgetCreds, pos: OpenPositionRow): Promise<boolean> {
  try {
    const rows = await fetchOcoPlanRows(creds, pos.symbol);
    return rows.some((r) => r.side === "sell" && r.size > 0 && Math.abs(r.size - pos.qty) / pos.qty <= 0.35);
  } catch {
    return true;
  }
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
  /* Patch S — sellability gate BEFORE touching protection. The old order
     (cancel OCO → read balance → market-sell) let Bitget's unfreeze lag
     produce a dust sellable qty: every retry was rejected with 400 [45110]
     "less than the minimum" (UAIUSDT 2026-10-02, four ticks in a row)
     while the position sat UNPROTECTED after the cancel. Now the balance
     is read first: only when the sellable notional clears the exchange
     minimum do we cancel the OCO and sell. Dust/zero balance → reconcile
     the OCO fill instead, protection left untouched. */
  const rules = await productRules(cfg.symbol);
  const minNotional = rules.minOrderUsdt > 0 ? rules.minOrderUsdt : FALLBACK_MIN_USDT;
  const preQtyStr = await liveSellQty(creds, pos);
  if (!preQtyStr || Number(preQtyStr) <= 0) {
    /* nothing sellable — the OCO probably fired already; reconcile WITHOUT
       cancelling anything (an armed OCO stays armed: exchange-owned exit) */
    const fill = await findOcoExitFill(creds, cfg, pos).catch(() => null);
    if (fill) {
      const { pnl, fee, note } = netPnlOf(pos, fill.price, fill.feeUsdt);
      await closePosition(pos.id, fill.price, pnl, `${exitReason} (reconciled from OCO fill)${note}`);
      await logTrade(cfg, {
        action: "SELL",
        status: "SUBMITTED",
        sizeUsdt: pos.sizeUsdt,
        qty: fill.qty,
        price: fill.price,
        reason: `${exitReason} (OCO fill reconciled)${note}`,
        pnlUsdt: pnl,
        detail: detailJson(signal, { exit: exitKind, reconciled: true, grossPnl: Number(((fill.price - pos.entryPrice) / pos.entryPrice) * pos.sizeUsdt), feeUsdt: fee }),
      });
      return { ...base, action: "SELL", reason: `${exitReason} (OCO fill reconciled)${note}`, pnlUsdt: pnl };
    }
    return { ...base, action: "HOLD", reason: `${exitKind} skipped — no sellable balance and no OCO fill found yet (proteksi tidak disentuh)` };
  }
  if (Number(preQtyStr) * fallbackPrice < minNotional) {
    return {
      ...base,
      action: "HOLD",
      reason: `${exitKind} skipped — sellable ${preQtyStr} × ${fallbackPrice.toPrecision(6)} di bawah minimum exchange ${minNotional} USDT (koin mungkin masih frozen); OCO/proteksi tidak dibatalkan, coba tick berikutnya`,
    };
  }
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
        const { pnl, fee, note } = netPnlOf(pos, fill.price, fill.feeUsdt);
        await closePosition(pos.id, fill.price, pnl, `${exitReason} (reconciled from OCO fill)${note}`);
        await logTrade(cfg, {
          action: "SELL",
          status: "SUBMITTED",
          sizeUsdt: pos.sizeUsdt,
          qty: fill.qty,
          price: fill.price,
          reason: `${exitReason} (OCO fill reconciled)${note}`,
          pnlUsdt: pnl,
          detail: detailJson(signal, { exit: exitKind, reconciled: true, grossPnl: Number(((fill.price - pos.entryPrice) / pos.entryPrice) * pos.sizeUsdt), feeUsdt: fee }),
        });
        return { ...base, action: "SELL", reason: `${exitReason} (OCO fill reconciled)${note}`, pnlUsdt: pnl };
      }
      return { ...base, action: "HOLD", reason: `${exitKind} skipped — no sellable balance and no OCO fill found yet` };
    }
    /* Patch S — rare race: the sellable balance shrank right after the
       cancel (unfreeze still settling). A below-minimum order is doomed;
       hold instead of burning the attempt. */
    if (Number(qtyStr) * fallbackPrice < minNotional) {
      return { ...base, action: "HOLD", reason: `${exitKind} skipped — sellable balance below the exchange minimum right after the OCO cancel; waiting for unfreeze, retry next tick` };
    }
    const placed = await placeSpotMarketOrder(creds, { symbol: cfg.symbol, side: "sell", quantity: qtyStr });
    const fill = await fetchOrderFill(creds, cfg.symbol, placed.orderId);
    const exitPrice = fill.priceAvg ?? fallbackPrice;
    const exitQty = fill.baseVolume ?? Number(qtyStr);
    const { pnl: livePnl, fee: feeUsdt, note: feeNote } = netPnlOf(pos, exitPrice, feeToUsdt(fill.fee, fill.feeCoin, fill.priceAvg));
    await closePosition(pos.id, exitPrice, livePnl, `${exitReason}${feeNote}`);
    await logTrade(cfg, {
      action: "SELL",
      status: "SUBMITTED",
      sizeUsdt: pos.sizeUsdt,
      qty: exitQty,
      price: exitPrice,
      orderId: placed.orderId,
      clientOid: placed.clientOid,
      reason: `${exitReason}${feeNote}`,
      pnlUsdt: livePnl,
      detail: detailJson(signal, { exit: exitKind, ocoCancelled: oco.cancelled, fillStatus: fill.status, grossPnl: Number(((exitPrice - pos.entryPrice) / pos.entryPrice) * pos.sizeUsdt), feeUsdt }),
    });
    return { ...base, action: "SELL", reason: `${exitReason}${feeNote}`, pnlUsdt: livePnl };
  } catch (err) {
    const msg = err instanceof Error ? err.message.slice(0, 160) : "sell failed";
    /* Patch G: a rejected sell (e.g. 43012 Insufficient balance) can also mean
       the exchange already sold the coins — the OCO fired between our cancel
       attempt and the sell. Reconcile once before giving up: if the OCO exit
       fill is on the book, close with the exchange's real numbers instead of
       retrying a doomed sell every tick. */
    const fill = await findOcoExitFill(creds, cfg, pos).catch(() => null);
    if (fill) {
      const { pnl, fee, note } = netPnlOf(pos, fill.price, fill.feeUsdt);
      await closePosition(pos.id, fill.price, pnl, `${exitReason} (reconciled after sell failure)${note}`);
      await logTrade(cfg, {
        action: "SELL",
        status: "SUBMITTED",
        sizeUsdt: pos.sizeUsdt,
        qty: fill.qty,
        price: fill.price,
        reason: `${exitReason} (OCO fill reconciled after sell rejection)${note}`,
        pnlUsdt: pnl,
        detail: detailJson(signal, { exit: exitKind, reconciled: true, sellError: msg, grossPnl: Number(((fill.price - pos.entryPrice) / pos.entryPrice) * pos.sizeUsdt), feeUsdt: fee }),
      });
      return { ...base, action: "SELL", reason: `${exitReason} (OCO fill reconciled)${note}`, pnlUsdt: pnl };
    }
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
  /* Patch Q — unreadable OCO state must HOLD: with the []-swallow gone, a
     read failure now surfaces here and guessing "naked" (market-selling or
     a false takeover) is exactly what the reconcile paths must never do. */
  const rows = await fetchOcoPlanRows(creds, pos.symbol).catch(() => null);
  if (rows === null) {
    return {
      ...base,
      action: "HOLD",
      reason: `${exitKind} crossed (${exitReason}) — status OCO tidak terbaca (baca plan order gagal); menunggu tick berikutnya, tidak menebak`,
    };
  }
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
    /* Patch L — the OCO is gone and no exit fill exists: either the plans
       were cancelled (engine/manual) or never armed. Between the bands the
       position is merely unprotected, not exit-worthy: HOLD and let the
       engine's own rules manage it (the trail/flip paths now see a missing
       OCO leg and may act). Once the price crosses a band, TAKE OVER and
       market-sell — waiting forever is how a naked position strands. The
       balance clamp keeps the takeover safe when the OCO actually did fire
       but the fill is not visible yet (frozen/zero balance → no sell →
       retry next tick). */
    if (price >= pos.targetPrice || price <= pos.stopPrice) {
      return liveEngineExit(
        cfg,
        creds,
        pos,
        signal,
        price,
        `${exitReason} (ambil alih — OCO tidak ada di exchange)`,
        exitKind
      );
    }
    return {
      ...base,
      action: "HOLD",
      reason: `${exitKind} crossed tetapi OCO tidak ditemukan di exchange dan harga masih di antara band — posisi dipantau engine (tanpa proteksi OCO)`,
    };
  }
  const { pnl, fee, note } = netPnlOf(pos, fill.price, fill.feeUsdt);
  await closePosition(pos.id, fill.price, pnl, `${exitReason} (via OCO)${note}`);
  await logTrade(cfg, {
    action: "SELL",
    status: "SUBMITTED",
    sizeUsdt: pos.sizeUsdt,
    qty: fill.qty,
    price: fill.price,
    reason: `${exitReason} (via OCO)${note}`,
    pnlUsdt: pnl,
    detail: detailJson(signal, { exit: exitKind, oco: true, grossPnl: Number(((fill.price - pos.entryPrice) / pos.entryPrice) * pos.sizeUsdt), feeUsdt: fee }),
  });
  return { ...base, action: "SELL", reason: `${exitReason} (via OCO)${note}`, pnlUsdt: pnl };
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
  /* Exit guardian — an OPEN POSITION must never be left unmanaged. Cron and
     guarded (non-force) runs therefore evaluate "enabled OR has-open-position":
     disabling a bot stops NEW entries, but its live/paper exits (TP/SL/trail)
     keep being managed. Explicit manual runs ("Run now") still see every bot
     of the user. (Measured reality this fixes: free-tier GitHub cron degrades
     to 2-7 h gaps, and a disabled bot used to strand its position forever.) */
  const openConfigIds = (
    await db.botPosition.findMany({ where: { status: "OPEN" }, select: { configId: true }, distinct: ["configId"] })
  ).map((r) => r.configId);
  const exitGuard = { OR: [{ enabled: true }, { id: { in: openConfigIds } }] };
  const configs = (await db.botConfig.findMany({
    where: opts.userId
      ? opts.force
        ? { userId: opts.userId }
        : { userId: opts.userId, ...exitGuard }
      : exitGuard,
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
      const reason = err instanceof Error ? err.message.slice(0, 200) : "unknown error";
      /* Silent per-bot failure is how a tick blackout goes unnoticed — every
         error lands in the audit trail (best-effort; never mask the original). */
      await logTrade(cfg, { action: "ERROR", status: "FAILED", reason }).catch(() => {});
      outcomes.push({ userId: cfg.userId, symbol: cfg.symbol, paper: cfg.paper, action: "ERROR", reason });
    }
  }
  return outcomes;
}

async function tickOne(cfg: BotConfigRow, force: boolean): Promise<TickOutcome> {
  /* Patch K — tick admission is a compare-and-swap on lastTickAt. Cron and
     the page heartbeat (or a manual "Run now" landing mid-cron) used to be
     able to run tickOne for the same bot CONCURRENTLY: both read
     openPositions as empty, both passed every gate, both placed an entry —
     the duplicate live position (OPNUSDT ×2, identical rows). The conditional
     update lets exactly one caller through; the loser skips this round. */
  const claim = await db.botConfig.updateMany({
    where: { id: cfg.id, lastTickAt: cfg.lastTickAt },
    data: { lastTickAt: new Date() },
  });
  if (claim.count === 0) {
    return {
      userId: cfg.userId,
      symbol: cfg.symbol,
      paper: cfg.paper,
      action: "SKIP",
      reason: "tick race lost — another tick is running this bot",
    };
  }
  const preset = MODE_PRESETS[(cfg.mode as BotMode) in MODE_PRESETS ? (cfg.mode as BotMode) : "MODERATE"];
  /* v2 phase 2 — signal timeframe (4H default = legacy behavior, zero regression). */
  const tf = isBotTimeframe(cfg.timeframe) ? cfg.timeframe : "4H";
  const bpy = barsPerYearFor(tf);
  const cooldownMin = cooldownMinFor((cfg.mode as BotMode) in MODE_PRESETS ? (cfg.mode as BotMode) : "MODERATE", tf);
  /* Patch H — honor the user's per-bot "Maks transaksi / hari" (1-20) exactly
     like TP/SL overrides below: saved value wins when valid, mode preset is
     only the fallback. Before this patch the engine ignored the saved value
     and always capped at the preset (MODERATE 4 / AGGRESSIVE 8). */
  const maxTradesPerDay =
    cfg.maxTradesPerDay && cfg.maxTradesPerDay >= 1 ? Math.floor(cfg.maxTradesPerDay) : preset.maxTradesPerDay;
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

  let openPositions = await db.botPosition.findMany({
    where: { configId: cfg.id, status: "OPEN" },
    orderBy: { openedAt: "asc" },
  });
  /* Patch K cleanup — pre-Patch-K twin rows (e.g. OPNUSDT ×2) collapse here
     on the first tick after deploy; the exit ladder below then manages
     exactly one survivor, keeping the ≤1-open-position invariant true. */
  openPositions = await collapseDuplicatePositions(cfg, openPositions);
  /* Patch M sweep — a live row with (nearly) zero wallet backing and no
     armed OCO cannot exist on the exchange (phantom whose real twin already
     exited, e.g. the OPNUSDT leftover); close it book-keeping-only so the
     exit ladder never stalls on a position that isn't there. */
  if (!cfg.paper && creds) {
    openPositions = await sweepOrphanPositions(cfg, creds, openPositions);
  }

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
      : `${exitKind}: ${reason}`;
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
    /* live exits — OCO-aware routing (Task 16, Patch L):
       · take-profit / original stop-loss on an OCO-armed position belong to
         the EXCHANGE — reconcile its real fill, never double-sell;
       · trail-stop and signal-flip on an OCO-armed position are BLOCKED while
         the exchange sell leg is still armed — cancelling protection to sell
         at a worse price is what cost the OPNUSDT trades their TP; with the
         leg gone the engine exits normally (takeover);
       · legacy positions without OCO behave exactly as before. */
    if (pos.tpslArmed && (exit === "take-profit" || (exit === "stop-loss" && !isTrail))) {
      const out = await liveOcoReconcile(cfg, creds!, pos, signal, price, exitReason, exitKind);
      await touchConfig(cfg.id, price);
      return out;
    }
    if (pos.tpslArmed) {
      /* Patch L — OCO guardianship: trail-stop and signal-flip are
         engine-initiated exits that used to CANCEL the exchange's TP/SL and
         market-sell. Measured result on OPNUSDT: the price crossed the TP
         between two ticks (high 0.0558 vs trigger 0.055386), the engine
         then trailed out at +0.37% and the +2% TP was never paid. While a
         sell leg is still armed, the EXCHANGE owns the exit: HOLD — never
         cancel protection to sell at a worse price. With the leg gone, the
         exit proceeds normally (the cancel is a harmless no-op). */
      const legArmed = await ocoSellLegArmed(creds!, pos);
      if (legArmed) {
        await db.botPosition.update({ where: { id: pos.id }, data: { highestPrice: newHighest } }).catch(() => {});
        await touchConfig(cfg.id, price);
        return {
          userId: cfg.userId,
          symbol: cfg.symbol,
          paper: false,
          action: "HOLD",
          reason: `${exitKind} ditunda — OCO TP/SL masih aktif di exchange (TP ${pos.targetPrice.toPrecision(6)}); exit milik exchange, engine tidak membatalkan proteksi`,
          score: signal.score,
        };
      }
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
    const out = await limitEntryTick(cfg, signal, price, effSlPct, effTpPct, tf, entryOffset, minUsdt, maxTradesPerDay);
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
    const out = await livePendingEntryTick(cfg, creds!, signal, price, effSlPct, effTpPct, minUsdt, rules.quantityPrecision, rules.pricePrecision, maxTradesPerDay);
    await touchConfig(cfg.id, price);
    return out;
  }

  /* ---- 2. Risk gates for a new entry ---- */
  const dayStart = utcDayStart();
  const todayTrades = await db.botTrade.findMany({
    where: { configId: cfg.id, createdAt: { gte: dayStart }, action: { in: ["BUY", "SELL"] }, status: { in: ["PAPER", "SUBMITTED"] }, paper: cfg.paper },
    orderBy: { createdAt: "desc" },
  });
  if (todayTrades.length >= maxTradesPerDay) {
    await touchConfig(cfg.id, price);
    return { userId: cfg.userId, symbol: cfg.symbol, paper: cfg.paper, action: "HOLD", reason: `max ${maxTradesPerDay} trades/day`, score: signal.score };
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
  const { available, error: balErr } = await liveFreeUsdt(creds!);
  if (available == null) {
    await touchConfig(cfg.id, price);
    return { userId: cfg.userId, symbol: cfg.symbol, paper: false, action: "HOLD", reason: `spot USDT balance unavailable${balErr ? ` — ${balErr}` : ""} — entry skipped this tick`, score: signal.score };
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
        expectPendingOrderId: null, // Patch K — fresh entry claims an empty slot
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
    const entryFeeUsdt = feeToUsdt(fill.fee, fill.feeCoin, fill.priceAvg);
    /* Patch K — entryOrderId fills the same unique mutex here: a market BUY
       can only ever produce one position row, whatever the ticks do. */
    let opened = true;
    try {
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
          entryOrderId: placed.orderId,
          entryFeeUsdt: entryFeeUsdt > 0 ? entryFeeUsdt : null,
          status: "OPEN",
        },
      });
    } catch (err) {
      if ((err as { code?: string })?.code !== "P2002") throw err;
      opened = false; // a concurrent tick already recorded this entry
    }
    if (opened) {
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
    }
    await touchConfig(cfg.id, price);
    return {
      userId: cfg.userId,
      symbol: cfg.symbol,
      paper: false,
      action: "BUY",
      reason: `${entryReason} — OCO TP/SL armed${opened ? "" : " (already opened by a concurrent tick)"}`,
      score: signal.score,
    };
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

/* ------------------------------------------------------------------ */
/* Patch L — commission-aware realized PnL                              */
/*                                                                      */
/* The engine used to record GROSS PnL (exit vs entry), while Bitget    */
/* charges ~0.1% per side — measured result: a +0.37% trail exit on     */
/* OPNUSDT showed +0.00 USDT while the account actually netted a small  */
/* LOSS after commission. Live closes now record PnL NET of the entry   */
/* and exit fees, using the exchange's real fee figures when the fill   */
/* reports them and the base-tier taker rate (0.1%/side) as the labeled */
/* estimate otherwise. Paper trading stays fee-free by design.          */
/* ------------------------------------------------------------------ */
const TAKER_FEE_RATE = 0.001;

/** Normalize a fill's fee to USDT: feeCoin USDT → as-is; base coin → × price. */
function feeToUsdt(fee: unknown, feeCoin: unknown, price: unknown): number {
  const f = Number(fee);
  if (!Number.isFinite(f) || f <= 0) return 0;
  const coin = String(feeCoin ?? "").toUpperCase();
  if (coin === "USDT") return f;
  const p = Number(price);
  return Number.isFinite(p) && p > 0 ? f * p : 0;
}

/**
 * Net realized PnL for a LIVE close: gross move minus entry + exit fees.
 * Unreadable fill fees degrade to the base-tier taker estimate per side —
 * the reason string labels the sum with "≈" so estimates stay honest.
 */
function netPnlOf(pos: OpenPositionRow, exitPrice: number, exitFeeUsdt: number): { pnl: number; fee: number; note: string } {
  const gross = ((exitPrice - pos.entryPrice) / pos.entryPrice) * pos.sizeUsdt;
  const entryFee = pos.entryFeeUsdt != null && pos.entryFeeUsdt >= 0 ? pos.entryFeeUsdt : pos.sizeUsdt * TAKER_FEE_RATE;
  const exitFee = exitFeeUsdt > 0 ? exitFeeUsdt : pos.sizeUsdt * TAKER_FEE_RATE;
  const fee = entryFee + exitFee;
  return { pnl: gross - fee, fee, note: ` (komisi ≈ ${fee.toFixed(4)} USDT)` };
}

/* Patch K cleanup — collapse legacy duplicate OPEN rows. Before the admission
   CAS existed, two concurrent ticks could both open the same position
   (OPNUSDT ×2: identical entry/TP/SL/size rows, one real Bitget order).
   The engine invariant is ≤1 open position per config, so a twin set is by
   definition a pre-Patch-K race leftover: keep the OLDEST row, mark the rest
   CLOSED with zero PnL — no exchange call, no fake SELL in the audit trail.
   The real order's OCO lives on the exchange and keeps being reconciled via
   the kept row. Twin fingerprint: entry price AND qty within 0.2% of the
   kept row (race twins are exact copies; genuinely different positions never
   match both). Runs oldest-first on the caller's ordering. */
async function collapseDuplicatePositions<T extends { id: string; entryPrice: number; qty: number }>(
  cfg: TradeLogConfig,
  positions: T[]
): Promise<T[]> {
  if (positions.length <= 1) return positions;
  const [keep, ...rest] = positions;
  const twins = rest.filter(
    (d) =>
      Math.abs(d.entryPrice - keep.entryPrice) / keep.entryPrice <= 0.002 &&
      Math.abs(d.qty - keep.qty) / keep.qty <= 0.002
  );
  if (twins.length === 0) return positions;
  await db.botPosition.updateMany({
    where: { id: { in: twins.map((d) => d.id) } },
    data: {
      status: "CLOSED",
      exitPrice: keep.entryPrice,
      realizedPnlUsdt: 0,
      exitReason: `duplikat dibersihkan otomatis (Patch K) — baris kembar digabung ke posisi ${keep.id}`,
      closedAt: new Date(),
    },
  });
  await logTrade(cfg, {
    action: "HOLD",
    status: "SUBMITTED",
    reason: `cleanup: ${twins.length} baris posisi duplikat ${cfg.symbol} digabung otomatis (tanpa order, posisi asli dipertahankan)`,
    detail: JSON.stringify({ dedup: true, kept: keep.id, removed: twins.map((d) => d.id) }),
  });
  const twinIds = new Set(twins.map((d) => d.id));
  return [keep, ...rest.filter((d) => !twinIds.has(d.id))];
}

/* Patch M — orphan sweep: an OPEN live row whose base coin has (nearly)
   vanished from the wallet cannot exist on the exchange. Measured case: the
   OPNUSDT phantom twin whose real sibling was trail-sold first — the Patch K
   collapse needs BOTH rows open to merge, so the survivor stayed open while
   every exit path stalled on "no sellable balance and no OCO fill" (the real
   sell is excluded from reconcile by engineSoldOrderIds). Ground truth is
   the wallet itself: when the exchange holds < 1% of the row's qty AND no
   OCO sell leg of matching size is armed, the row is closed
   book-keeping-only — PnL 0, exit at entry price, no exchange call, no fake
   SELL in the audit trail (same honest treatment as the Patch K collapse;
   the real trade's PnL is already recorded on its own row).
   Fail-safe: a failed balance read or OCO read skips the sweep this tick. */
async function sweepOrphanPositions<T extends { id: string; entryPrice: number; qty: number; openedAt: Date }>(
  cfg: TradeLogConfig,
  creds: BitgetCreds,
  positions: T[]
): Promise<T[]> {
  if (cfg.paper || positions.length === 0) return positions;
  /* Patch Q — min age 60 min: a freshly opened position is NEVER swept, no
     matter what the reads say. The ARX case swept OCO-protected rows ~5 min
     after entry when the plan-order read failed and the (frozen) balance
     read ~0 — age is the network-free last line of defense. */
  const MIN_AGE_MS = 60 * 60 * 1000;
  const nowMs = Date.now();
  const avail = await fetchSpotBalance(creds, baseCoinOf(cfg.symbol))
    .then((b) => (b ? Math.max(b.available, 0) + Math.max(b.frozen, 0) : 0)) /* Patch Q — frozen/locked coins (e.g. locked by an armed plan) are still held; absent row = 0 */
    .catch(() => null);
  if (avail === null) return positions; /* balance read failed — never guess */
  const candidates = positions.filter(
    (p) => avail < p.qty * 0.01 && nowMs - p.openedAt.getTime() >= MIN_AGE_MS
  );
  if (candidates.length === 0) return positions;
  /* protection guard: a matching armed OCO sell leg keeps its row on the
     normal reconcile paths — the sweep only takes provably naked rows.
     Patch Q — fetchOcoPlanRows now THROWS on failure, so this catch is
     reachable: a failed OCO read skips the sweep this tick (fail-safe real). */
  const legs = await fetchOcoPlanRows(creds, cfg.symbol).catch(() => null);
  if (legs === null) return positions;
  const orphans = candidates.filter(
    (p) => !legs.some((r) => r.side === "sell" && r.size > 0 && Math.abs(r.size - p.qty) / p.qty <= 0.35)
  );
  if (orphans.length === 0) return positions;
  const now = new Date();
  for (const o of orphans) {
    await db.botPosition.update({
      where: { id: o.id },
      data: {
        status: "CLOSED",
        exitPrice: o.entryPrice,
        realizedPnlUsdt: 0,
        exitReason: `posisi yatim dibersihkan otomatis (Patch M) — saldo riil ${baseCoinOf(cfg.symbol)} ${avail.toPrecision(4)} (< 1% ukuran posisi) tanpa OCO aktif di exchange; baris tanpa cadangan ditutup tanpa order`,
        closedAt: now,
      },
    });
  }
  await logTrade(cfg, {
    action: "HOLD",
    status: "SUBMITTED",
    reason: `cleanup: ${orphans.length} posisi yatim ${cfg.symbol} ditutup otomatis (saldo riil ≈ 0, tanpa OCO; baris phantom — tanpa order)`,
    detail: JSON.stringify({ orphanSweep: true, balance: avail, removed: orphans.map((o) => o.id) }),
  });
  const orphanIds = new Set(orphans.map((o) => o.id));
  return positions.filter((p) => !orphanIds.has(p.id));
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
  let positions = await db.botPosition.findMany({
    where: { configId: cfg.id, status: "OPEN" },
    orderBy: { openedAt: "asc" },
  });
  /* Patch K cleanup — collapse twin rows first so a manual close never
     cancels the OCO / market-sells twice for one real exchange order. */
  positions = await collapseDuplicatePositions(cfg, positions);
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

  /* Patch M — orphan sweep first: a live row with (nearly) zero wallet
     backing and no armed OCO is closed book-keeping-only instead of
     attempting a sell that would fail with zero balance every time. */
  if (!cfg.paper && creds) {
    const kept = await sweepOrphanPositions(cfg, creds, positions);
    for (const swept of positions.filter((p) => !kept.includes(p))) {
      out.closed += 1;
      out.results.push({ positionId: swept.id, price: swept.entryPrice, pnlUsdt: 0 });
    }
    positions = kept;
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
      /* Patch S — never place a sell below the exchange minimum: after the
         OCO cancel Bitget may lag unfreezing, so the sellable qty can be
         dust (the 400 [45110] loop, UAIUSDT 2026-10). Manual close still
         cancels protection FIRST (explicit user intent to exit now), but
         the doomed order is skipped with a clear, actionable message. */
      const rules = await productRules(cfg.symbol);
      const minNotional = rules.minOrderUsdt > 0 ? rules.minOrderUsdt : FALLBACK_MIN_USDT;
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
          const { pnl: livePnl, fee, note } = netPnlOf(pos, fill.price, fill.feeUsdt);
          await closePosition(pos.id, fill.price, livePnl, `${reason} (OCO fill reconciled)${note}`);
          await logTrade(cfg, {
            action: "SELL",
            status: "SUBMITTED",
            sizeUsdt: pos.sizeUsdt,
            qty: fill.qty,
            price: fill.price,
            reason: `${reason} (OCO fill reconciled)${note}`,
            pnlUsdt: livePnl,
            detail: JSON.stringify({ manual: true, reconciled: true, grossPnl: Number(((fill.price - pos.entryPrice) / pos.entryPrice) * pos.sizeUsdt), feeUsdt: fee }),
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
      if (Number(qtyStr) * (ticker ?? pos.entryPrice) < minNotional) {
        const emsg = `manual close skipped — sellable ${qtyStr} × ${(ticker ?? pos.entryPrice).toPrecision(6)} di bawah minimum exchange ${minNotional} USDT (koin mungkin masih unfreeze); coba lagi beberapa saat`;
        await logTrade(cfg, { action: "SELL", status: "FAILED", reason: emsg });
        out.ok = false;
        out.results.push({ positionId: pos.id, price: null, pnlUsdt: null, error: emsg });
        continue;
      }
      const placed = await placeSpotMarketOrder(creds!, { symbol: cfg.symbol, side: "sell", quantity: qtyStr });
      const fill = await fetchOrderFill(creds!, cfg.symbol, placed.orderId);
      const exitPrice = fill.priceAvg ?? ticker ?? pos.entryPrice;
      const exitQty = fill.baseVolume ?? Number(qtyStr);
      const { pnl: livePnl, fee: feeUsdt, note: feeNote } = netPnlOf(pos, exitPrice, feeToUsdt(fill.fee, fill.feeCoin, fill.priceAvg));
      await closePosition(pos.id, exitPrice, livePnl, `${reason}${feeNote}`);
      await logTrade(cfg, {
        action: "SELL",
        status: "SUBMITTED",
        sizeUsdt: pos.sizeUsdt,
        qty: exitQty,
        price: exitPrice,
        orderId: placed.orderId,
        clientOid: placed.clientOid,
        reason: `${reason}${feeNote}`,
        pnlUsdt: livePnl,
        detail: JSON.stringify({ manual: true, fillStatus: fill.status, grossPnl: Number(((exitPrice - pos.entryPrice) / pos.entryPrice) * pos.sizeUsdt), feeUsdt }),
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
    action: "BUY" | "SELL" | "HOLD" | "ERROR";
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
