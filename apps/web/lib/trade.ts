"use client";

/**
 * Optimistic confirmation: the sign moment is the only gratification in a
 * product that then locks the position for up to 24 hours, so it must land
 * INSTANTLY. placeBet() records the bet as pending straight away — pot
 * bar, chart marker, panel position all update client-side — then the
 * chain result reconciles it: confirmed keeps it, failure rolls everything
 * back visibly with the reason. Components subscribe via usePendingBets.
 *
 * Real chain: when an `auth` token getter is passed, the bet goes to
 * /api/bet — a Privy-signed swap on the market's curve — and the promise
 * that reconciles the optimistic state is the real transaction. Without
 * auth (dev demo viewer) the old simulated chain stays.
 */
import { useEffect, useState } from "react";

import { refreshLive } from "./live";
import { scannerStore } from "./scanner";
import { playPlacedSound } from "./sound";
import { refreshWallet } from "./wallet";

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
  /** Privy access-token getter: presence = the real chain rail. */
  auth?: () => Promise<string | null>;
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

  const fail = (reason: string) => {
    bet.state = "failed";
    bet.reason = reason;
    emit();
    // failed bets stay visible long enough to be read, then clear
    setTimeout(() => {
      const i = pending.indexOf(bet);
      if (i >= 0) pending.splice(i, 1);
      emit();
    }, 6_000);
  };

  if (opts.auth) {
    // Real chain: Privy-signed swap via the server.
    void (async () => {
      try {
        const token = await opts.auth!();
        if (!token) return fail("log in to bet");
        const res = await fetch("/api/bet", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify({ marketId: opts.marketId, side: opts.side, amountUsd: opts.amountUsd }),
        });
        const data = (await res.json().catch(() => ({}))) as { signature?: string; error?: string };
        if (!res.ok || !data.signature) return fail(data.error ?? "bet failed");
        bet.state = "confirmed";
        emit();
        // the numbers move NOW, not on the next 60s poll
        refreshLive();
        refreshWallet();
      } catch {
        fail("network error, nothing was placed");
      }
    })();
    return bet;
  }

  // Simulated chain (dev demo viewer only): ~1.2s to land.
  setTimeout(() => {
    if (opts.amountUsd > DEMO_BALANCE_USD) {
      fail(`not enough in your wallet ($${DEMO_BALANCE_USD.toLocaleString("en-US")} available)`);
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
