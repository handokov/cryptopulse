import { NextRequest, NextResponse } from "next/server";
import { runAnalysis, FACTOR_KEYS, type FactorKey, type AnalysisResult, safeLocale } from "@/lib/analysis-engine";

export const dynamic = "force-dynamic";

interface AnalysisRequest {
  symbol?: string;
  horizon?: number;
  locale?: unknown;
  factors?: Partial<Record<FactorKey, number>>;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as AnalysisRequest;
    const symbol = typeof body.symbol === "string" ? body.symbol : "BTC";
    const horizon = typeof body.horizon === "number" && Number.isFinite(body.horizon) ? body.horizon : 30;
    const locale = safeLocale(body.locale);

    const factors = {} as Record<FactorKey, number>;
    for (const key of FACTOR_KEYS) {
      const raw = body.factors?.[key];
      const val = typeof raw === "number" && Number.isFinite(raw) ? raw : 50;
      factors[key] = Math.min(Math.max(val, 0), 100);
    }

    const result: AnalysisResult = await runAnalysis(symbol, factors, horizon, locale);
    return NextResponse.json(result);
  } catch (err) {
    console.error("analysis route error:", err);
    return NextResponse.json({ error: "Analysis failed" }, { status: 500 });
  }
}
