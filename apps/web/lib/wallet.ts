"use client";

/**
 * Client wallet state: the viewer's real Privy wallet (address +
 * balance), fetched with their Privy access token. Null while logged
 * out or for the dev demo viewer (demo identities have no wallets).
 *
 * SINGLE-FLIGHT, SHARED: every component reads one module-level store —
 * N mounted consumers never means N requests, and first-time
 * provisioning (a slow create on the server) cannot race itself.
 * Failures retry on a short backoff instead of waiting for the next
 * scheduled poll.
 */
import { usePrivy } from "@privy-io/react-auth";
import { useCallback, useEffect, useState } from "react";

export interface WalletView {
  address: string;
  balanceUsd: number;
  /** Refundable rent parked in token accounts — where the "missing" money is. */
  rentUsd: number;
}

let cached: WalletView | null = null;
let lastError: string | null = null;
let inflight: Promise<void> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryMs = 2_000;
const subs = new Set<() => void>();
const emit = () => subs.forEach((fn) => fn());

/** Last token getter from a mounted consumer: lets non-hook code
 * (the trade layer, after a confirmed bet) refresh the balance. */
let lastGetToken: (() => Promise<string | null>) | null = null;
export const refreshWallet = (): void => {
  if (lastGetToken) void load(lastGetToken);
};

const scheduleRetry = (getToken: () => Promise<string | null>) => {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void load(getToken);
  }, retryMs);
  retryMs = Math.min(retryMs * 2, 30_000);
};

async function fetchWallet(getToken: () => Promise<string | null>): Promise<void> {
  try {
    const token = await getToken();
    if (!token) {
      // token mid-refresh: try again shortly, this is not a dead end
      lastError = "waiting for session";
      emit();
      scheduleRetry(getToken);
      return;
    }
    const res = await fetch("/api/wallet", { headers: { Authorization: `Bearer ${token}` } });
    const data = (await res.json().catch(() => ({}))) as WalletView & { error?: string };
    if (!res.ok || !data.address) {
      throw new Error(data.error ?? `wallet api ${res.status}`);
    }
    cached = data;
    lastError = null;
    retryMs = 2_000;
    emit();
  } catch (err) {
    lastError = (err as Error).message.slice(0, 120);
    emit();
    scheduleRetry(getToken);
  }
}

function load(getToken: () => Promise<string | null>): Promise<void> {
  if (!inflight) {
    inflight = fetchWallet(getToken).finally(() => {
      inflight = null;
    });
  }
  return inflight;
}

export function useWallet(): {
  wallet: WalletView | null;
  error: string | null;
  refresh: () => void;
  send: (to: string, amountUsd: number) => Promise<{ signature?: string; error?: string }>;
} {
  const { authenticated, getAccessToken } = usePrivy();
  const [, bump] = useState(0);

  useEffect(() => {
    const sub = () => bump((n) => n + 1);
    subs.add(sub);
    return () => {
      subs.delete(sub);
    };
  }, []);

  useEffect(() => {
    if (!authenticated) {
      cached = null;
      return;
    }
    lastGetToken = getAccessToken;
    void load(getAccessToken);
    const t = setInterval(() => void load(getAccessToken), 60_000);
    return () => clearInterval(t);
  }, [authenticated, getAccessToken]);

  const refresh = useCallback(() => {
    if (authenticated) void load(getAccessToken);
  }, [authenticated, getAccessToken]);

  const send = useCallback(
    async (to: string, amountUsd: number) => {
      const token = await getAccessToken();
      if (!token) return { error: "not logged in" };
      const res = await fetch("/api/wallet/send", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ to, amountUsd }),
      });
      const data = (await res.json()) as { signature?: string; error?: string };
      if (res.ok) refresh();
      return data;
    },
    [getAccessToken, refresh],
  );

  return { wallet: authenticated ? cached : null, error: lastError, refresh, send };
}
