"use client";

/**
 * Live data source: one fetch of /api/markets shared by every page via
 * context, refreshed every 60s. The derived queries the pages need are
 * parameterized ports of lib/fixtures' helpers — same names, same math,
 * data passed in instead of closed over.
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

import type {
  ChartSeries,
  FixtureMarket,
  LeaderRow,
  OpenPosition,
  TradeFixture,
  TraderRow,
} from "./fixtures";

export interface LiveWorld {
  markets: FixtureMarket[];
  tradesByMarket: Record<string, TradeFixture[]>;
  seriesByMarket: Record<string, ChartSeries>;
  leaderboard: LeaderRow[];
  loading: boolean;
}

const EMPTY: LiveWorld = { markets: [], tradesByMarket: {}, seriesByMarket: {}, leaderboard: [], loading: true };

const LiveContext = createContext<LiveWorld>(EMPTY);

export function LiveProvider({ children }: { children: ReactNode }) {
  const [world, setWorld] = useState<LiveWorld>(EMPTY);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch("/api/markets");
        if (!res.ok) return;
        const data = (await res.json()) as Omit<LiveWorld, "loading">;
        if (alive && data.markets) setWorld({ ...data, loading: false });
      } catch {
        // network hiccup: keep the last world
      }
    };
    void load();
    const t = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  return <LiveContext.Provider value={world}>{children}</LiveContext.Provider>;
}

export const useLive = (): LiveWorld => useContext(LiveContext);

// --- derived queries (fixture helpers, parameterized) -----------------------

export const marketById = (w: LiveWorld, id: string) =>
  w.markets.find((m) => m.data.marketId === id);

export const marketsByPost = (w: LiveWorld, postId: string) =>
  w.markets.filter((m) => m.postId === postId);

export const feedMarkets = (w: LiveWorld) =>
  [...w.markets].sort((a, b) => {
    const open = (m: FixtureMarket) => (m.data.status === "open" ? 1 : 0);
    return open(b) - open(a) || b.netStakedUsd - a.netStakedUsd;
  });

export const marketsByParticipant = (w: LiveWorld, handle: string) =>
  w.markets.filter(
    (m) =>
      m.data.a.handle === handle || m.data.b.handle === handle || m.taggerHandle === handle,
  );

export const allHandles = (w: LiveWorld): string[] => {
  const set = new Set<string>();
  for (const m of w.markets) {
    set.add(m.data.a.handle);
    set.add(m.data.b.handle);
    set.add(m.taggerHandle);
  }
  return [...set].sort();
};

export const openPositionsFor = (w: LiveWorld, handle: string | null): OpenPosition[] => {
  if (!handle) return [];
  const out: OpenPosition[] = [];
  for (const m of w.markets) {
    if (m.data.status !== "open") continue;
    const trades = (w.tradesByMarket[m.data.marketId] ?? []).filter(
      (t) => t.handle === handle && t.direction === "buy",
    );
    for (const side of ["a", "b"] as const) {
      const mine = trades.filter((t) => t.side === side);
      if (mine.length === 0) continue;
      const staked = mine.reduce((s, t) => s + t.amountUsd, 0);
      out.push({
        marketId: m.data.marketId,
        side,
        sideHandle: (side === "a" ? m.data.a : m.data.b).handle,
        otherHandle: (side === "a" ? m.data.b : m.data.a).handle,
        netStakedUsd: staked,
        tokens: Math.round(staked * 0.983),
        enteredAtMs: Math.min(...mine.map((t) => t.atMs)),
      });
    }
  }
  return out;
};

export const likeGapSince = (w: LiveWorld, pos: OpenPosition): number => {
  const m = marketById(w, pos.marketId);
  const s = w.seriesByMarket[pos.marketId];
  if (!m || !s || s.ts.length === 0) return 0;
  let i = 0;
  while (i < s.ts.length - 1 && s.ts[i]! < pos.enteredAtMs) i++;
  const gapAt = (a: number, b: number) => (pos.side === "a" ? a - b : b - a);
  const entryGap = gapAt(s.likesA[i]!, s.likesB[i]!);
  const nowGap = gapAt(m.data.a.likes, m.data.b.likes);
  return nowGap - entryGap;
};

export const positionFor = (w: LiveWorld, viewer: string | null, marketId: string) => {
  const p = openPositionsFor(w, viewer).find((x) => x.marketId === marketId);
  return p ? { side: p.side, tokens: p.tokens, netStakedUsd: p.netStakedUsd } : null;
};

export const traderBoard = (w: LiveWorld, win: "all" | "day" | "week"): TraderRow[] => {
  const now = Date.now();
  const sinceMs = win === "day" ? now - 86_400_000 : win === "week" ? now - 7 * 86_400_000 : 0;
  const acc = new Map<string, { wins: number; losses: number; profitUsd: number }>();
  for (const m of w.markets) {
    if (m.data.status === "open" || !m.data.winner) continue;
    const trades = (w.tradesByMarket[m.data.marketId] ?? []).filter(
      (t) => t.direction === "buy" && t.atMs >= sinceMs,
    );
    if (trades.length === 0) continue;
    const pot = (m.data.a.potUsd + m.data.b.potUsd) * (1 - 0.0125);
    const winnerPot = (m.data.winner === "a" ? m.data.a : m.data.b).potUsd || 1;
    for (const t of trades) {
      const row = acc.get(t.handle) ?? { wins: 0, losses: 0, profitUsd: 0 };
      if (t.side === m.data.winner) {
        row.wins += 1;
        row.profitUsd += t.amountUsd * (pot / winnerPot) - t.amountUsd;
      } else {
        row.losses += 1;
        row.profitUsd -= t.amountUsd;
      }
      acc.set(t.handle, row);
    }
  }
  return [...acc.entries()]
    .map(([handle, r]) => ({
      handle,
      ...r,
      winRate: r.wins + r.losses === 0 ? 0 : r.wins / (r.wins + r.losses),
    }))
    .sort((x, y) => y.profitUsd - x.profitUsd);
};

export interface ProfileStats {
  handle: string;
  asOriginal: number;
  asReply: number;
  asTagger: number;
  wins: number;
  losses: number;
  volumeUsd: number;
  biggestMarketUsd: number;
  timesRatiod: number;
  feesEarnedUsd: number;
  feesByRole: { original: number; reply: number; tagger: number };
  unclaimedUsd: number;
}

export const profileFor = (w: LiveWorld, handle: string): ProfileStats => {
  const mine = marketsByParticipant(w, handle);
  const row = w.leaderboard.find((r) => r.handle === handle);
  const settled = mine.filter(
    (m) => m.data.status === "settled" || m.data.status === "forfeited",
  );
  const won = settled.filter((m) => {
    const winner = m.data.winner === "a" ? m.data.a.handle : m.data.b.handle;
    return winner === handle;
  }).length;
  return {
    handle,
    asOriginal: mine.filter((m) => m.data.a.handle === handle).length,
    asReply: mine.filter((m) => m.data.b.handle === handle).length,
    asTagger: mine.filter((m) => m.taggerHandle === handle).length,
    wins: won,
    losses: settled.length - won,
    volumeUsd: mine.reduce((s, m) => s + m.volumeUsd, 0),
    biggestMarketUsd: Math.max(0, ...mine.map((m) => m.volumeUsd)),
    timesRatiod: settled.filter(
      (m) => m.data.a.handle === handle && m.data.winner === "b",
    ).length,
    feesEarnedUsd: row?.totalFeeUsd ?? 0,
    feesByRole: row?.byRole ?? { original: 0, reply: 0, tagger: 0 },
    unclaimedUsd: row ? Math.round(row.totalFeeUsd * 100) / 100 : 0,
  };
};
