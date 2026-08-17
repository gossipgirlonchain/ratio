"use client";

/**
 * Optimistic confirmation: the sign moment is the only gratification in a
 * product that then locks the position for up to 24 hours, so it must land
 * INSTANTLY. placeBet() records the bet as pending straight away — pot
 * bar, chart marker, panel position all update client-side — then the
 * chain result reconciles it: confirmed keeps it, failure rolls everything
 * back visibly with the reason. Components subscribe via usePendingBets.
 *
 * Fixture world: the "chain" is a timeout that enforces the wallet
 * balance. The real DopplerMarketChain drops in behind the same promise.
 */
import { useEffect, useState } from "react";

import { scannerStore } from "./scanner";
import { playPlacedSound } from "./sound";

export interface PendingBet {
  id: string;
  marketId: string;
  side: "a" | "b";
  amountUsd: number;
  atMs: number;
  state: "confirming" | "confirmed" | "failed";
  /** Only on failure: shown to the user, verbatim. */
  reason?: string;
}

/** Demo wallet balance — the simulated chain's only rejection rule. */
export const DEMO_BALANCE_USD = 2_500;

const EVENT = "ratio-trade";
const pending: PendingBet[] = [];
let nextId = 1;

const emit = () => window.dispatchEvent(new Event(EVENT));

export function placeBet(opts: {
  marketId: string;
  side: "a" | "b";
  amountUsd: number;
}): PendingBet {
  const bet: PendingBet = {
    id: `pb${nextId++}`,
    ...opts,
    atMs: Date.now(),
    state: "confirming",
  };
  pending.push(bet);
  playPlacedSound();
  // Instrumentation: a bet within 30min of clicking a scanner alert for
  // this market counts as alert-led — the number that decides whether
  // auto-trading is ever worth building.
  scannerStore.creditBetFromAlert(opts.marketId);
  emit();

  // Simulated chain: ~1.2s to land. Real impl: the swap tx promise.
  setTimeout(() => {
    if (opts.amountUsd > DEMO_BALANCE_USD) {
      bet.state = "failed";
      bet.reason = `not enough in your wallet ($${DEMO_BALANCE_USD.toLocaleString("en-US")} available)`;
      emit();
      // failed bets stay visible long enough to be read, then clear
      setTimeout(() => {
        const i = pending.indexOf(bet);
        if (i >= 0) pending.splice(i, 1);
        emit();
      }, 6_000);
    } else {
      bet.state = "confirmed";
      emit();
    }
  }, 1_200);
  return bet;
}

/** Live pending/confirmed bets, optionally scoped to one market. */
export function usePendingBets(marketId?: string): PendingBet[] {
  const [, bump] = useState(0);
  useEffect(() => {
    const on = () => bump((n) => n + 1);
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  return marketId ? pending.filter((b) => b.marketId === marketId) : [...pending];
}
