/**
 * Portfolio sync engine: exchange balances → matched top-100 coins →
 * auto-synced holdings. This is the ONLY place that imports/removes
 * exchange-derived holdings; manual holdings (connectionId = null) are never
 * touched.
 *
 * Matching rule: exchange asset symbol (uppercased) → first coin in the
 * market-cap-descending top-100 board (plus pinned coins) with the same
 * symbol (first hit = the highest-cap asset using that ticker). Assets the
 * board doesn't know get ONE conservative fallback — exact-symbol CoinGecko
 * search, price sanity-checked against the exchange's own ticker on Bitget
 * — so recent small-cap listings still import; everything else is reported
 * as unmatched. Matched assets are priced through the shared CoinGecko
 * simple/price fetcher with the board snapshot as fallback.
 */

import { db } from "@/lib/db";
import { fetchSimplePrices } from "@/lib/coin-prices";
import {
  getMatchUniverse,
  searchCoinBySymbol,
  type MatchCandidate,
} from "@/lib/top100";
import { decryptSecret } from "@/lib/secure";
import {
  ExchangeError,
  ExchangeId,
  fetchExchangeBalances,
} from "./index";
import { fetchBitgetTickerPrice } from "./bitget";

export interface MatchedAsset {
  coinId: string;
  symbol: string;
  name: string;
  image: string | null;
  quantity: number;
  price: number | null;
  valueUsd: number | null;
  action: "created" | "updated" | "unchanged";
}

export interface UnmatchedAsset {
  asset: string;
  quantity: number;
}

export interface SyncOutcome {
  syncedAt: string;
  exchange: ExchangeId;
  matched: MatchedAsset[];
  unmatched: UnmatchedAsset[];
  removed: { symbol: string; quantity: number }[];
  added: number;
  updated: number;
  removedCount: number;
  totalValueUsd: number;
  pricedCount: number;
}

/** Runs a full sync for one stored connection. Throws ExchangeError on failure. */
export async function syncConnection(
  connectionId: string,
  userId: string
): Promise<SyncOutcome> {
  const conn = await db.exchangeConnection.findFirst({
    where: { id: connectionId, userId },
  });
  if (!conn) throw new ExchangeError("unexpected", "connection not found");

  const exchange = conn.exchange as ExchangeId;
  let outcome: SyncOutcome;

  try {
    outcome = await runSync(conn, exchange);
  } catch (err) {
    // Record the failure on the connection, then propagate for the route to map.
    const code = err instanceof ExchangeError ? err.code : "unexpected";
    const detail = err instanceof ExchangeError ? err.detail : undefined;
    await db.exchangeConnection
      .update({
        where: { id: conn.id },
        data: { status: "error", lastError: detail ? `${code}: ${detail}` : code },
      })
      .catch(() => undefined);
    throw err;
  }

  await db.exchangeConnection
    .update({
      where: { id: conn.id },
      data: { status: "active", lastError: null, lastSyncAt: new Date() },
    })
    .catch(() => undefined);

  return outcome;
}

async function runSync(
  conn: { id: string; userId: string; exchange: string; apiKeyEnc: string; apiSecretEnc: string; apiPassphraseEnc: string | null },
  exchange: ExchangeId
): Promise<SyncOutcome> {
  /* 1. Fetch raw balances (demo stores encrypted empty strings — decrypt
        uniformly, the demo adapter simply ignores them). */
  const balances = await fetchExchangeBalances(exchange, {
    apiKey: decryptSecret(conn.apiKeyEnc),
    apiSecret: decryptSecret(conn.apiSecretEnc),
    apiPassphrase: conn.apiPassphraseEnc ? decryptSecret(conn.apiPassphraseEnc) : undefined,
  });

  /* 2. Match asset symbols against the coin universe. The top-100 board is
        preferred; a /coins-list fallback keeps sync working while the markets
        endpoint is rate-limited. Both unavailable → typed "market" error. */
  const universe = await getMatchUniverse();
  if (!universe) throw new ExchangeError("market", "coin universe unavailable");
  const bySymbol = new Map<string, MatchCandidate>();
  for (const coin of universe) {
    const sym = coin.symbol.toUpperCase();
    if (!bySymbol.has(sym)) bySymbol.set(sym, coin); // board order = mcap-desc → first hit wins
  }

  /* 2b. Assets the board doesn't know (recent small-cap / launchpad
        listings) get one conservative fallback: resolve the SYMBOL via
        CoinGecko search (exact-symbol hits only, best market-cap rank),
        then — on Bitget — sanity-check the candidate's live price against
        the exchange's own ticker (±50% band) so a same-ticker imposter
        coin can't sneak in. Anything still unresolved stays in the
        unmatched list that the sync result surfaces. */
  const boardMisses = balances.filter((b) => !bySymbol.has(b.asset.toUpperCase()));
  if (boardMisses.length > 0) {
    const lookup = boardMisses.slice(0, 8); // bound per-sync latency
    const candidates = new Map<string, MatchCandidate>();
    await Promise.all(
      lookup.map(async (b) => {
        const c = await searchCoinBySymbol(b.asset);
        if (c) candidates.set(b.asset.toUpperCase(), c);
      })
    );
    if (candidates.size > 0) {
      const candidateIds = [...new Set([...candidates.values()].map((c) => c.id))];
      const { map: resolvePrices } = await fetchSimplePrices(candidateIds);
      for (const [sym, cand] of candidates) {
        cand.price = resolvePrices[cand.id]?.usd ?? null;
        let ok = true;
        if (exchange === "bitget") {
          const exPrice = await fetchBitgetTickerPrice(`${sym}USDT`);
          if (exPrice != null && cand.price != null) {
            ok = Math.abs(cand.price - exPrice) / exPrice <= 0.5;
          }
        }
        if (ok && !bySymbol.has(sym)) bySymbol.set(sym, cand);
      }
    }
  }

  const matchedRows: { balance: (typeof balances)[number]; coin: MatchCandidate }[] = [];
  const unmatched: UnmatchedAsset[] = [];
  for (const balance of balances) {
    const coin = bySymbol.get(balance.asset.toUpperCase());
    if (coin) matchedRows.push({ balance, coin });
    else unmatched.push({ asset: balance.asset, quantity: balance.free + balance.locked });
  }

  /* 3. Live prices for matched coins (snapshot price as fallback). */
  const coinIds = [...new Set(matchedRows.map(({ coin }) => coin.id))];
  const { map: livePrices } = await fetchSimplePrices(coinIds);
  const priceOf = (coin: MatchCandidate): number | null => {
    const live = livePrices[coin.id]?.usd;
    if (Number.isFinite(live) && live > 0) return live;
    return coin.price != null && coin.price > 0 ? coin.price : null;
  };

  /* 4. Upsert holdings scoped to this connection. */
  const existing = await db.holding.findMany({
    where: { userId: conn.userId, connectionId: conn.id },
  });
  const existingByCoinId = new Map(existing.map((h) => [h.coinId, h]));

  const matched: MatchedAsset[] = [];
  let added = 0;
  let updated = 0;
  const now = new Date();

  for (const { balance, coin } of matchedRows) {
    const quantity = balance.free + balance.locked;
    const price = priceOf(coin);
    const valueUsd = price != null ? quantity * price : null;
    const prev = existingByCoinId.get(coin.id);

    if (!prev) {
      await db.holding.create({
        data: {
          userId: conn.userId,
          coinId: coin.id,
          symbol: coin.symbol,
          name: coin.name,
          image: coin.image || null,
          quantity,
          // Cost basis starts at today's price (0% P&L) — the user can edit
          // the holding afterwards to record the real purchase price.
          purchasePrice: price ?? 0,
          purchaseDate: now,
          connectionId: conn.id,
        },
      });
      added += 1;
      matched.push(toMatched(coin, quantity, price, valueUsd, "created"));
    } else {
      const changed = Math.abs(prev.quantity - quantity) > 1e-12;
      await db.holding.update({
        where: { id: prev.id },
        data: {
          quantity,
          symbol: coin.symbol,
          name: coin.name,
          image: coin.image || null,
        },
      });
      if (changed) updated += 1;
      matched.push(
        toMatched(coin, quantity, price, valueUsd, changed ? "updated" : "unchanged")
      );
    }
  }

  /* 5. Remove holdings this connection previously imported whose assets no
        longer exist on the exchange (true mirror semantics). */
  const keepIds = new Set(matchedRows.map(({ coin }) => coin.id));
  const stale = existing.filter((h) => !keepIds.has(h.coinId));
  if (stale.length > 0) {
    await db.holding.deleteMany({ where: { id: { in: stale.map((h) => h.id) } } });
  }

  const totalValueUsd = matched.reduce((acc, m) => acc + (m.valueUsd ?? 0), 0);
  return {
    syncedAt: now.toISOString(),
    exchange,
    matched,
    unmatched,
    removed: stale.map((h) => ({ symbol: h.symbol, quantity: h.quantity })),
    added,
    updated,
    removedCount: stale.length,
    totalValueUsd,
    pricedCount: matched.filter((m) => m.valueUsd != null).length,
  };
}

function toMatched(
  coin: MatchCandidate,
  quantity: number,
  price: number | null,
  valueUsd: number | null,
  action: MatchedAsset["action"]
): MatchedAsset {
  return {
    coinId: coin.id,
    symbol: coin.symbol,
    name: coin.name,
    image: coin.image || null,
    quantity,
    price,
    valueUsd,
    action,
  };
}
