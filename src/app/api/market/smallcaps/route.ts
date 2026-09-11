/**
 * GET /api/market/smallcaps?minVol=200000 — Bitget small-cap screener:
 * online USDT spot pairs OUTSIDE the tracked board (top-100 + pinned
 * symbols), tokenized equities and stables removed, 24 h USDT volume above
 * the threshold, sorted volume-desc (capped at 60 rows).
 */

import { NextResponse } from "next/server";
import { getTop100 } from "@/lib/top100";
import { getBitgetSmallcaps } from "@/lib/market/smallcaps";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const raw = Number(new URL(req.url).searchParams.get("minVol") ?? "200000");
  const minVol = Number.isFinite(raw) && raw >= 0 ? raw : 200000;
  try {
    /* Board symbols double as the exclusion set — a board upstream failure
       degrades the whole route (same policy as the sync universe). */
    const board = (await getTop100()).coins;
    const exclude = new Set(board.map((c) => c.symbol.toUpperCase()));
    const result = await getBitgetSmallcaps(minVol, 60, exclude);
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "upstream" }, { status: 502 });
  }
}
