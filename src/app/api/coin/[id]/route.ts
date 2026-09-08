import { NextRequest, NextResponse } from "next/server";
import { getCoinSnapshot } from "@/lib/coin-series";

export const dynamic = "force-dynamic";

/**
 * GET /api/coin/[id] — full AssetSnapshot (90-day series included) for any
 * CoinGecko coin id, so every top-100 asset is traceable through the labs.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const snap = await getCoinSnapshot(id);
  if (!snap) {
    return NextResponse.json({ error: "coin data unavailable" }, { status: 502 });
  }
  return NextResponse.json(snap);
}
