/**
 * GET  /api/exchange-connections — list the signed-in user's connections
 *                                  (sanitized: masked key only, no secrets).
 * POST /api/exchange-connections — validate + test credentials against the
 *                                  exchange, store them encrypted, then run
 *                                  an initial sync that imports matched
 *                                  assets into the portfolio.
 */

import { NextResponse } from "next/server";
import { createHash } from "crypto";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { encryptSecret, maskSecret } from "@/lib/secure";
import {
  ExchangeError,
  exchangeNeedsCredentials,
  exchangeNeedsPassphrase,
  fetchExchangeBalances,
  isExchangeId,
} from "@/lib/exchanges";
import { syncConnection } from "@/lib/exchanges/sync";

export const dynamic = "force-dynamic";

export interface ConnectionRow {
  id: string;
  exchange: string;
  label: string | null;
  apiKeyMasked: string;
  status: string;
  lastError: string | null;
  lastSyncAt: string | null;
  createdAt: string;
  assetCount: number;
}

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const rows = await db.exchangeConnection.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
  });
  const counts = await db.holding.groupBy({
    by: ["connectionId"],
    where: { userId: user.id, connectionId: { not: null } },
    _count: { _all: true },
  });
  const countByConn = new Map(
    counts.map((c) => [c.connectionId as string, c._count._all])
  );

  const connections: ConnectionRow[] = rows.map((c) => ({
    id: c.id,
    exchange: c.exchange,
    label: c.label,
    apiKeyMasked: c.apiKeyMasked,
    status: c.status,
    lastError: c.lastError,
    lastSyncAt: c.lastSyncAt?.toISOString() ?? null,
    createdAt: c.createdAt.toISOString(),
    assetCount: countByConn.get(c.id) ?? 0,
  }));

  return NextResponse.json({ connections });
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: {
    exchange?: unknown;
    label?: unknown;
    apiKey?: unknown;
    apiSecret?: unknown;
    apiPassphrase?: unknown;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "validation" }, { status: 400 });
  }

  const exchange = body.exchange;
  if (!isExchangeId(exchange)) {
    return NextResponse.json({ error: "validation" }, { status: 400 });
  }
  const label =
    typeof body.label === "string" && body.label.trim()
      ? body.label.trim().slice(0, 60)
      : null;
  const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
  const apiSecret = typeof body.apiSecret === "string" ? body.apiSecret.trim() : "";
  const apiPassphrase =
    typeof body.apiPassphrase === "string" ? body.apiPassphrase.trim() : "";

  if (exchangeNeedsCredentials(exchange) && (apiKey.length < 8 || apiSecret.length < 8)) {
    return NextResponse.json({ error: "validation" }, { status: 400 });
  }
  if (exchangeNeedsPassphrase(exchange) && apiPassphrase.length === 0) {
    return NextResponse.json({ error: "validation" }, { status: 400 });
  }

  /* Reject exact duplicates without decrypting anything (key hash). */
  const apiKeyHash = createHash("sha256").update(apiKey).digest("hex");
  const dup = await db.exchangeConnection.findUnique({
    where: { userId_exchange_apiKeyHash: { userId: user.id, exchange, apiKeyHash } },
  });
  if (dup) return NextResponse.json({ error: "duplicate" }, { status: 409 });

  /* Live test against the exchange before storing anything. */
  try {
    await fetchExchangeBalances(exchange, { apiKey, apiSecret, apiPassphrase: apiPassphrase || undefined });
  } catch (err) {
    if (err instanceof ExchangeError) {
      return NextResponse.json({ error: err.code }, { status: 422 });
    }
    return NextResponse.json({ error: "unexpected" }, { status: 500 });
  }

  const created = await db.exchangeConnection.create({
    data: {
      userId: user.id,
      exchange,
      label,
      apiKeyEnc: encryptSecret(apiKey),
      apiSecretEnc: encryptSecret(apiSecret),
      apiPassphraseEnc: apiPassphrase ? encryptSecret(apiPassphrase) : null,
      apiKeyMasked: maskSecret(apiKey),
      apiKeyHash,
    },
  });

  /* Initial sync imports the matched assets right away. */
  try {
    const outcome = await syncConnection(created.id, user.id);
    return NextResponse.json(
      { connectionId: created.id, outcome },
      { status: 201 }
    );
  } catch (err) {
    // Connection stored but first sync failed (e.g. board temporarily down);
    // surface a distinct code so the UI can explain the state.
    const code = err instanceof ExchangeError ? err.code : "generic";
    return NextResponse.json({ connectionId: created.id, error: code }, { status: 207 });
  }
}
