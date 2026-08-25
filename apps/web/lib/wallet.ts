"use client";

/**
 * Client wallet state: fetches the viewer's real Privy wallet (address +
 * balance) with their Privy access token. Null while logged out or for
 * the dev demo viewer (demo identities have no wallets, by design).
 */
import { usePrivy } from "@privy-io/react-auth";
import { useCallback, useEffect, useState } from "react";

export interface WalletView {
  address: string;
  balanceUsd: number;
}

export function useWallet(): {
  wallet: WalletView | null;
  refresh: () => void;
  send: (to: string, amountUsd: number) => Promise<{ signature?: string; error?: string }>;
} {
  const { authenticated, getAccessToken } = usePrivy();
  const [wallet, setWallet] = useState<WalletView | null>(null);

  const refresh = useCallback(() => {
    if (!authenticated) {
      setWallet(null);
      return;
    }
    void (async () => {
      try {
        const token = await getAccessToken();
        if (!token) return;
        const res = await fetch("/api/wallet", { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) return;
        const data = (await res.json()) as WalletView;
        if (data.address) setWallet(data);
      } catch {
        // keep last known wallet on network hiccups
      }
    })();
  }, [authenticated, getAccessToken]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 60_000);
    return () => clearInterval(t);
  }, [refresh]);

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

  return { wallet, refresh, send };
}
