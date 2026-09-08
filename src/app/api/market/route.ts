import { NextResponse } from "next/server";
import { getMarketSnapshot } from "@/lib/market-data";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const snapshot = await getMarketSnapshot();
    return NextResponse.json(snapshot);
  } catch (err) {
    console.error("market route error:", err);
    return NextResponse.json({ error: "Failed to load market snapshot" }, { status: 500 });
  }
}
