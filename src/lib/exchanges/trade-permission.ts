/**
 * Trade-permission persistence (Task 17).
 *
 * Loads a stored ExchangeConnection, probes its Bitget spot-trade scope
 * (see probeTradePermission — the call can never place a real order) and
 * persists the verdict on the row. Non-Bitget connections are skipped
 * (their exchanges are not used by the live bot).
 *
 * "inconclusive" probes deliberately leave the stored permission state
 * untouched — only a clear granted/denied verdict may flip the badge.
 */

import { db } from "@/lib/db";
import { decryptSecret } from "@/lib/secure";
import { probeTradePermission } from "./bitget";

/** The verdict as STORED on the row ("unverified" = no clear probe yet). */
export interface StoredProbe {
  state: "granted" | "denied" | "unverified";
  message?: string;
}

export async function probeAndStoreTradePermission(connectionId: string): Promise<StoredProbe | null> {
  const conn = await db.exchangeConnection.findUnique({ where: { id: connectionId } });
  if (!conn || conn.exchange !== "bitget") return null;
  if (conn.status !== "active") return null;

  const result = await probeTradePermission({
    apiKey: decryptSecret(conn.apiKeyEnc),
    apiSecret: decryptSecret(conn.apiSecretEnc),
    apiPassphrase: conn.apiPassphraseEnc ? decryptSecret(conn.apiPassphraseEnc) : undefined,
  });

  // Keep the previous verdict on inconclusive probes (network hiccup, odd
  // upstream message) — flipping to "unverified" would erase a good badge.
  const state =
    result.state === "inconclusive" ? (conn.tradePermission === "denied" || conn.tradePermission === "granted" ? conn.tradePermission : "unverified") : result.state;

  await db.exchangeConnection.update({
    where: { id: connectionId },
    data: {
      tradePermission: state,
      tradeProbedAt: new Date(),
      tradeProbeNote: result.message ? result.message.slice(0, 200) : null,
    },
  });
  return { state, message: result.message };
}
