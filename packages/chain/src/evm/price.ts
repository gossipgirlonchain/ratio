/**
 * ETH/USD, live.
 *
 * A bet can be written either way — "$25 @handle" or "0.01 @handle" — and both
 * land as the same ETH transaction. This is the rate that connects them.
 *
 * What it is allowed to affect: how big a stake is, and what a number renders
 * as on screen. What it can never affect: settlement. Payouts are
 * `yourTokens / claimableSupply * netPot` in wei, and no price appears in that
 * expression at any point. So a stale or wrong rate can size a bet slightly
 * differently than intended; it cannot pay the wrong person or the wrong
 * amount. That property is the reason the conversion happens here at the edge
 * rather than anywhere near the pot.
 *
 * It still fails LOUD rather than guessing. A bet priced off a silently stale
 * rate is a bet the user did not intend, so past the staleness window this
 * throws and the bet does not land.
 */

export interface PriceSource {
  /** USD per 1 ETH. Throws rather than returning a stale or absent price. */
  (): Promise<number>;
}

const SPOT_URL = "https://api.coinbase.com/v2/prices/ETH-USD/spot";

export interface CoinbasePriceOpts {
  /** Serve a cached rate for this long before refetching. */
  ttlMs?: number;
  /** Past this, a cached rate is refused rather than used. */
  maxStaleMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export class StalePriceError extends Error {}

/**
 * Coinbase spot: public, keyless, and the same number the user sees quoted
 * everywhere else. Cached, because a mention burst would otherwise hit it once
 * per bet for a rate that moves far slower than that.
 */
export function coinbaseEthUsd(opts: CoinbasePriceOpts = {}): PriceSource {
  const ttlMs = opts.ttlMs ?? 60_000;
  const maxStaleMs = opts.maxStaleMs ?? 10 * 60_000;
  const doFetch = opts.fetchImpl ?? fetch;
  const now = opts.now ?? Date.now;

  let cached: { usd: number; atMs: number } | undefined;
  let inflight: Promise<number> | undefined;

  const load = async (): Promise<number> => {
    const res = await doFetch(SPOT_URL);
    if (!res.ok) throw new Error(`coinbase spot -> ${res.status}`);
    const body = (await res.json()) as { data?: { amount?: string } };
    const usd = Number(body.data?.amount);
    if (!Number.isFinite(usd) || usd <= 0) {
      throw new Error(`coinbase spot returned an unusable price: ${body.data?.amount}`);
    }
    cached = { usd, atMs: now() };
    return usd;
  };

  return async () => {
    const age = cached ? now() - cached.atMs : Infinity;
    if (cached && age < ttlMs) return cached.usd;

    // Single-flight: a burst of mentions must not become a burst of requests.
    inflight ??= load().finally(() => {
      inflight = undefined;
    });

    try {
      return await inflight;
    } catch (err) {
      // A brief outage is survivable — the rate barely moves. A long one is
      // not, because we would be pricing bets off a number from another market.
      if (cached && now() - cached.atMs <= maxStaleMs) {
        console.error(
          `  eth price fetch failed, using rate from ${Math.round((now() - cached.atMs) / 1000)}s ago:`,
          (err as Error).message,
        );
        return cached.usd;
      }
      throw new StalePriceError(
        `no usable ETH price (last good ${cached ? `${Math.round(age / 1000)}s ago` : "never"}): ${(err as Error).message}`,
      );
    }
  };
}

/** Fixed rate, for tests and the sim. Never for anything that touches money. */
export const fixedEthUsd = (usd: number): PriceSource => async () => usd;
