/**
 * GET /api/bot/candles?symbol=LITUSDT&tf=4H&limit=180
 *
 * v2 phase 2 — OHLC candles + the bot's trigger context for the chart card:
 *   - candles: full OHLC rows ascending (last row = still-forming bar, the
 *     same data the engine's signal computes on) from Bitget's public API
 *   - price:   live ticker (best effort) for the "waiting for touch" state
 *   - signal:  composite score + entry threshold the engine would apply
 *   - bands:   effective TP/SL percents (VOL-scaled when the bot uses that
 *     exit style) so the chart can preview the exit ladder anchored to the
 *     draggable entry line
 *
 * Auth required (the chart lives in the gated dashboard); responses cached
 * in-memory per (symbol, tf, limit) for 45 s so drag-save-refetch cycles
 * stay polite to Bitget's public API.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { fetchCandles, fetchTickerPrice, barsPerYearFor } from "@/lib/bot/bitget-trade";
import { computeBotSignal, MODE_PRESETS, TF_OPTIONS, volBands, type BotMode } from "@/lib/bot/strategy";
import { ensureBotColumns } from "@/lib/bot/migrate";

export const dynamic = "force-dynamic";

const SYMBOL_RE = /^[A-Z0-9]{2,10}USDT$/;

interface CacheRow {
  at: number;
  payload: unknown;
}
const cache = new Map<string, CacheRow>();
const CACHE_MS = 45_000;

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  await ensureBotColumns();

  const url = new URL(req.url);
  const symbol = (url.searchParams.get("symbol") ?? "").toUpperCase();
  if (!SYMBOL_RE.test(symbol)) {
    return NextResponse.json({ error: "validation", message: "symbol must look like BTCUSDT" }, { status: 400 });
  }
  const tfParam = (url.searchParams.get("tf") ?? "4H").toUpperCase();
  const tf = (Object.values(TF_OPTIONS).flat() as string[]).includes(tfParam) ? tfParam : "4H";
  const rawLimit = Number(url.searchParams.get("limit") ?? 180);
  const limit = Number.isFinite(rawLimit) ? Math.min(300, Math.max(60, Math.floor(rawLimit))) : 180;

  /* The user's bot for this symbol decides mode/exit style → effective bands. */
  const cfg = await db.botConfig.findUnique({
    where: { userId_symbol: { userId: user.id, symbol } },
  });
  const mode: BotMode = cfg && (cfg.mode as BotMode) in MODE_PRESETS ? (cfg.mode as BotMode) : "MODERATE";
  const preset = MODE_PRESETS[mode];
  const exitStyle = cfg?.exitStyle ?? "FIXED";

  const cacheKey = `${symbol}:${tf}:${limit}:${mode}:${exitStyle}:${cfg?.takeProfitPct ?? ""}:${cfg?.stopLossPct ?? ""}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_MS) {
    return NextResponse.json(hit.payload);
  }

  const bpy = barsPerYearFor(tf);
  const candles = await fetchCandles(symbol, tf, limit);
  const closes = candles.map((c) => c.close);
  const signal = computeBotSignal(closes, bpy);

  /* Effective exit bands — mirrors the engine's tickOne logic exactly. */
  const volMode = exitStyle === "VOL";
  const sigmaPct = (signal.volAnnPct / 100) / Math.sqrt(bpy) * 100;
  const vol = volMode ? volBands(sigmaPct, mode) : null;
  const presetTp = cfg?.takeProfitPct && cfg.takeProfitPct > 0 ? cfg.takeProfitPct : preset.takeProfitPct;
  const presetSl = cfg?.stopLossPct && cfg.stopLossPct > 0 ? cfg.stopLossPct : preset.stopLossPct;
  const tpPct = vol && !(cfg?.takeProfitPct && cfg.takeProfitPct > 0) ? vol.tpPct : presetTp;
  const slPct = vol && !(cfg?.stopLossPct && cfg.stopLossPct > 0) ? vol.slPct : presetSl;

  let price: number | null = null;
  try {
    price = await fetchTickerPrice(symbol);
  } catch {
    price = null;
  }

  const payload = {
    symbol,
    tf,
    limit,
    price,
    candles,
    signal: {
      score: signal.score,
      entryScore: preset.entryScore,
      volAnnPct: signal.volAnnPct,
      sigmaPct,
    },
    bands: {
      tpPct,
      slPct,
      exitStyle,
      trailArmPct: vol?.trailArmPct ?? null,
    },
  };
  cache.set(cacheKey, { at: Date.now(), payload });
  return NextResponse.json(payload);
}
