"use client";

/**
 * The payout quote, priced by the curve rather than by dividing pot totals.
 *
 * Entry is curve-priced: tokens per dollar falls as a side's raise grows, so
 * what you are owed is a TOKEN share of the projected pot. The linear
 * pot-split in `@ratio/ui` is the small-stake limit of that and it overstates
 * large stakes — the exact case where a wrong quote costs someone real money.
 * `/api/quote` simulates the swap on chain and reads the token denominator
 * from the index.
 */
import type { PayoutQuote } from "@ratio/ui";

/**
 * One stable function per market. The strip takes this as a dependency of the
 * effect that fetches, so a fresh identity on every render would re-quote
 * forever.
 */
const byMarket = new Map<string, (side: "a" | "b", stakeUsd: number) => Promise<PayoutQuote | null>>();

/**
 * Only markets whose money is actually indexed can be quoted from the curve —
 * a fixture, or a market opened on Solana, has no EVM pool to simulate
 * against. Those keep the approximation, which is the best thing that exists
 * for them, rather than showing an empty slot where a payout belongs.
 */
export function curveQuoteIf(indexed: boolean, marketId: string) {
  return indexed ? curveQuote(marketId) : undefined;
}

export function curveQuote(marketId: string) {
  const cached = byMarket.get(marketId);
  if (cached) return cached;

  const fn = async (side: "a" | "b", stakeUsd: number): Promise<PayoutQuote | null> => {
    const res = await fetch("/api/quote", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ marketId, side: side === "a" ? 0 : 1, stakeUsd }),
    });
    // A refused quote is not a zero quote: a settled market, or an index we
    // cannot reach, means we do not know, and the slot stays empty.
    if (!res.ok) return null;
    const d = (await res.json()) as { payoutUsd: number; multiple: number };
    return { payoutUsd: d.payoutUsd, multiple: d.multiple };
  };
  byMarket.set(marketId, fn);
  return fn;
}
