/**
 * One shared fixture world for every page. Different pages are different
 * queries against the same data and the same strip component (site
 * architecture: the strip is the atom). Shapes mirror the agent store so
 * swapping in Supabase later is a data-source change, not a redesign.
 */
import type { MarketStripData } from "@ratio/ui";

export const NOW = Date.now();
const H = 3_600_000;

const av = (h: string) => `https://i.pravatar.cc/60?u=${h}`;

export interface FixtureMarket {
  data: MarketStripData;
  /** reply vs quote tweet — the scanner's market-type condition. */
  pairType: "reply" | "quote";
  taggerHandle: string;
  volumeUsd: number; // gross buys — the historical fact
  netStakedUsd: number; // what is in it right now — feed ranking
  postId: string; // tweet_a_id
}

export const markets: FixtureMarket[] = [
  {
    postId: "p-chart",
    pairType: "reply",
    taggerHandle: "scout",
    volumeUsd: 125,
    netStakedUsd: 125,
    data: {
      marketId: "m1",
      a: { handle: "mainchar", avatarUrl: av("mainchar"), text: "posting my chart. the bottom is in, you can screenshot this", likes: 880, potUsd: 125 },
      b: { handle: "challenger", avatarUrl: av("challenger"), text: "brave of you to post this with the chart upside down", likes: 610, potUsd: 0 },
      settlesAtMs: NOW + 23 * H + 12 * 60_000,
      status: "open",
    },
  },
  {
    postId: "p-remote",
    pairType: "reply",
    taggerHandle: "scout",
    volumeUsd: 2_600,
    netStakedUsd: 2_600,
    data: {
      marketId: "m2",
      a: { handle: "bigaccount", avatarUrl: av("bigaccount"), text: "unpopular opinion but remote work made everyone worse at their jobs and nobody wants to admit it", likes: 12_400, potUsd: 1_960 },
      b: { handle: "replyguy", avatarUrl: av("replyguy"), text: "this is exactly the kind of take that sounds smart until you spend five minutes with the actual numbers, which you clearly have not done, so let me walk you through it", likes: 9_800, potUsd: 640 },
      settlesAtMs: NOW + 9 * H + 22 * 60_000,
      status: "open",
    },
  },
  {
    postId: "p-cereal",
    pairType: "reply",
    taggerHandle: "dave",
    volumeUsd: 680,
    netStakedUsd: 680,
    data: {
      marketId: "m3",
      a: { handle: "opinionhaver", avatarUrl: av("opinionhaver"), text: "cereal is a soup", likes: 3_100, potUsd: 240 },
      b: { handle: "quietkid", avatarUrl: av("quietkid"), text: "no.", likes: 7_450, potUsd: 440 },
      settlesAtMs: NOW + 4 * H + 51 * 60_000,
      status: "open",
    },
  },
  {
    postId: "p-criticism",
    pairType: "quote",
    taggerHandle: "scout",
    volumeUsd: 1_300,
    netStakedUsd: 1_300,
    data: {
      marketId: "m4",
      a: { handle: "thinskinned", avatarUrl: av("thinskinned"), text: "criticism of my product is just engagement farming at this point", likes: 2_300, potUsd: 410 },
      b: { handle: "hiddenreply", avatarUrl: av("hiddenreply"), text: "screenshotting this before it disappears, which it will", likes: 4_100, potUsd: 890 },
      settlesAtMs: NOW + 6 * H,
      status: "open",
      hiddenFromThread: true,
    },
  },
  {
    postId: "p-remote",
    pairType: "reply",
    taggerHandle: "carol",
    volumeUsd: 3_550,
    netStakedUsd: 0,
    data: {
      marketId: "m5",
      a: { handle: "bigaccount", avatarUrl: av("bigaccount"), text: "nobody under 30 can name three Beatles songs", likes: 18_200, potUsd: 2_400 },
      b: { handle: "replyguy", avatarUrl: av("replyguy"), text: "aged like milk and it has only been six hours", likes: 21_900, potUsd: 1_150 },
      settlesAtMs: NOW - 2 * H,
      status: "settled",
      winner: "b",
    },
  },
  {
    postId: "p-delete",
    pairType: "reply",
    taggerHandle: "scout",
    volumeUsd: 115,
    netStakedUsd: 0,
    data: {
      marketId: "m6",
      a: { handle: "deleter", avatarUrl: av("deleter"), text: "watch me say it anyway", likes: 950, potUsd: 75 },
      b: { handle: "witness", avatarUrl: av("witness"), text: "he is absolutely going to delete this", likes: 430, potUsd: 40 },
      settlesAtMs: NOW - H,
      status: "forfeited",
      winner: "b",
    },
  },
];

// --- store-query mirrors ----------------------------------------------------

export const marketById = (id: string) => markets.find((m) => m.data.marketId === id);

export const marketsByPost = (postId: string) => markets.filter((m) => m.postId === postId);

export const feedMarkets = () =>
  markets
    .filter((m) => m.data.status === "open")
    .sort((a, b) => b.netStakedUsd - a.netStakedUsd);

export const marketsByParticipant = (handle: string) =>
  markets.filter(
    (m) =>
      m.data.a.handle === handle ||
      m.data.b.handle === handle ||
      m.taggerHandle === handle,
  );

export interface TradeFixture {
  handle: string;
  side: "a" | "b";
  direction: "buy" | "sell";
  amountUsd: number;
  atMs: number;
}

/** Trade list for the market page — buys and sells both. */
export const tradesByMarket: Record<string, TradeFixture[]> = {
  m2: [
    { handle: "bigaccount", side: "a", direction: "buy", amountUsd: 1_200, atMs: NOW - 13 * H },
    { handle: "dave", side: "a", direction: "buy", amountUsd: 760, atMs: NOW - 9 * H },
    { handle: "erin", side: "b", direction: "buy", amountUsd: 400, atMs: NOW - 11 * H },
    // No sell fixtures: sells are protocol-impossible (SELLS_ENABLED).
    // The direction field stays — recorded, unbackfillable, costs nothing.
    { handle: "gina", side: "b", direction: "buy", amountUsd: 160, atMs: NOW - 5 * H },
    { handle: "fred", side: "b", direction: "buy", amountUsd: 240, atMs: NOW - 2 * H },
  ],
  m1: [{ handle: "gary", side: "a", direction: "buy", amountUsd: 125, atMs: NOW - 20 * 60_000 }],
  m3: [
    { handle: "carol", side: "a", direction: "buy", amountUsd: 240, atMs: NOW - 6 * H },
    { handle: "erin", side: "b", direction: "buy", amountUsd: 380, atMs: NOW - 5 * H },
    { handle: "bigaccount", side: "b", direction: "buy", amountUsd: 60, atMs: NOW - 5 * H },
  ],
  // Decided markets keep their trades: the trader board and profile
  // records are computed from these, exactly like the store will.
  m5: [
    { handle: "carol", side: "a", direction: "buy", amountUsd: 1_400, atMs: NOW - 24 * H },
    { handle: "dave", side: "a", direction: "buy", amountUsd: 1_000, atMs: NOW - 22 * H },
    { handle: "erin", side: "b", direction: "buy", amountUsd: 700, atMs: NOW - 21 * H },
    { handle: "fred", side: "b", direction: "buy", amountUsd: 450, atMs: NOW - 20 * H },
  ],
  m6: [
    { handle: "gary", side: "a", direction: "buy", amountUsd: 75, atMs: NOW - 23 * H },
    { handle: "erin", side: "b", direction: "buy", amountUsd: 40, atMs: NOW - 22 * H },
  ],
  m4: [
    { handle: "dave", side: "a", direction: "buy", amountUsd: 410, atMs: NOW - 4 * H },
    { handle: "carol", side: "b", direction: "buy", amountUsd: 890, atMs: NOW - 3 * H },
  ],
};

export interface LeaderRow {
  handle: string;
  totalFeeUsd: number;
  byRole: { original: number; reply: number; tagger: number };
}

export const leaderboard: Record<"all" | "day" | "week", LeaderRow[]> = {
  all: [
    { handle: "bigaccount", totalFeeUsd: 41.2, byRole: { original: 38.1, reply: 0, tagger: 3.1 } },
    { handle: "replyguy", totalFeeUsd: 33.4, byRole: { original: 1.2, reply: 30.8, tagger: 1.4 } },
    { handle: "scout", totalFeeUsd: 18.9, byRole: { original: 0, reply: 0, tagger: 18.9 } },
    { handle: "quietkid", totalFeeUsd: 6.1, byRole: { original: 0.4, reply: 5.7, tagger: 0 } },
    { handle: "opinionhaver", totalFeeUsd: 4.4, byRole: { original: 4.4, reply: 0, tagger: 0 } },
  ],
  week: [
    { handle: "replyguy", totalFeeUsd: 12.7, byRole: { original: 0, reply: 12.1, tagger: 0.6 } },
    { handle: "bigaccount", totalFeeUsd: 11.9, byRole: { original: 11.9, reply: 0, tagger: 0 } },
    { handle: "scout", totalFeeUsd: 7.2, byRole: { original: 0, reply: 0, tagger: 7.2 } },
  ],
  day: [
    { handle: "thinskinned", totalFeeUsd: 3.7, byRole: { original: 3.7, reply: 0, tagger: 0 } },
    { handle: "hiddenreply", totalFeeUsd: 3.7, byRole: { original: 0, reply: 3.7, tagger: 0 } },
    { handle: "scout", totalFeeUsd: 2.4, byRole: { original: 0, reply: 0, tagger: 2.4 } },
  ],
};

export interface ProfileFixture {
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

export const profileFor = (handle: string): ProfileFixture => {
  const mine = marketsByParticipant(handle);
  const row = leaderboard.all.find((r) => r.handle === handle);
  // Forfeits are decided markets: they count toward wins, losses, and
  // times ratio'd exactly like a likes win.
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
    unclaimedUsd: row ? Math.round(row.totalFeeUsd * 0.6 * 100) / 100 : 0,
  };
};

/**
 * Deterministic chart series (no Math.random: mount-gated pages, stable
 * across renders). Real data replaces this with recorded trades — the
 * shape (likes per side over time + volume buckets per side) is exactly
 * what the store's trade records reconstruct.
 */
export interface ChartSeries {
  ts: number[];
  likesA: number[];
  likesB: number[];
  /** Money per interval, split two ways that never share a channel:
   * DIRECTION is vertical (buys up, sells down), SIDE is colour. */
  buyA: number[];
  buyB: number[];
  sellA: number[];
  sellB: number[];
}

export function chartSeries(m: FixtureMarket): ChartSeries {
  // Bucket count scales with activity — a thin market in fixed fine
  // buckets renders as mostly empty intervals. (Real impl: size buckets
  // from trade count, targeting a handful of trades per bucket.)
  const points = m.volumeUsd > 2_000 ? 48 : m.volumeUsd > 500 ? 30 : 16;
  const seed = m.data.marketId.charCodeAt(1) * 7.3;
  const openMs = m.data.settlesAtMs - 24 * H;
  const end = Math.min(NOW, m.data.settlesAtMs);
  const wob = (i: number, k: number) => Math.sin(seed + i * k) * 0.5 + 0.5;
  const ts: number[] = [];
  const likesA: number[] = [];
  const likesB: number[] = [];
  const buyA: number[] = [];
  const buyB: number[] = [];
  const sellA: number[] = [];
  const sellB: number[] = [];
  const grow = (from: number, to: number, i: number, k: number) => {
    const p = i / (points - 1);
    const eased = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
    return from + (to - from) * eased * (0.9 + 0.2 * wob(i, k));
  };
  let maxA = 0;
  let maxB = 0;
  for (let i = 0; i < points; i++) {
    ts.push(openMs + ((end - openMs) * i) / (points - 1));
    // likes only accumulate: running max keeps the lines honest
    maxA = Math.max(maxA, grow(m.data.a.likes * 0.55, m.data.a.likes, i, 1.7));
    maxB = Math.max(maxB, grow(m.data.b.likes * 0.2, m.data.b.likes, i, 2.3));
    likesA.push(Math.round(maxA));
    likesB.push(Math.round(maxB));
    const spikeA = wob(i, 3.1);
    const spikeB = wob(i, 4.7);
    buyA.push(spikeA > 0.78 ? (m.data.a.potUsd / 6) * spikeA : 0);
    buyB.push(spikeB > 0.82 ? (m.data.b.potUsd / 5) * spikeB : 0);
    // sells are protocol-impossible (SELLS_ENABLED): always zero. The
    // channel stays because the encoding is permanent and recorded.
    sellA.push(0);
    sellB.push(0);
  }
  return { ts, likesA, likesB, buyA, buyB, sellA, sellB };
}

// --- positions --------------------------------------------------------------

export interface OpenPosition {
  marketId: string;
  side: "a" | "b";
  sideHandle: string;
  otherHandle: string;
  netStakedUsd: number;
  tokens: number;
  /** First buy: entry time for the like-gap read. */
  enteredAtMs: number;
}

/** Open positions for any handle, derived from trades — visible to every
 * visitor (profiles are permissionless, positions are public record). */
export const openPositionsFor = (handle: string | null): OpenPosition[] => {
  if (!handle) return [];
  const out: OpenPosition[] = [];
  for (const m of markets) {
    if (m.data.status !== "open") continue;
    const trades = (tradesByMarket[m.data.marketId] ?? []).filter(
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

/**
 * Like gap movement since entry: OUR live PnL. Money cannot move while a
 * position is locked, but the like counts move for 24 hours straight —
 * "your side is up 400 likes since you signed" is the number to watch.
 * Entry likes are sampled from the recorded series (the likes sampler is
 * the only source of historical likes; nothing else can backfill it).
 */
export const likeGapSince = (pos: OpenPosition): number => {
  const m = marketById(pos.marketId);
  if (!m) return 0;
  const s = chartSeries(m);
  let i = 0;
  while (i < s.ts.length - 1 && s.ts[i]! < pos.enteredAtMs) i++;
  const gapAt = (a: number, b: number) => (pos.side === "a" ? a - b : b - a);
  const entryGap = gapAt(s.likesA[i]!, s.likesB[i]!);
  const nowGap = gapAt(m.data.a.likes, m.data.b.likes);
  return nowGap - entryGap;
};

/** Demo position for the trade panel: what the viewer holds, if anything. */
export const positionFor = (viewer: string | null, marketId: string) => {
  const p = openPositionsFor(viewer).find((x) => x.marketId === marketId);
  return p ? { side: p.side, tokens: p.tokens, netStakedUsd: p.netStakedUsd } : null;
};

// --- trader board -----------------------------------------------------------

export interface TraderRow {
  handle: string;
  wins: number;
  losses: number;
  winRate: number;
  profitUsd: number;
}

/**
 * The OTHER leaderboard: people good at BETTING, not people being bet on.
 * Computed from trades on decided markets, exactly the store query's
 * shape: winners split the pot minus the 1.25% fee token-weighted,
 * losers forfeit their stake. Ranked by profit so a visitor can find
 * someone worth copying and click through to what they're backing now.
 */
export const traderBoard = (win: "all" | "day" | "week"): TraderRow[] => {
  const sinceMs = win === "day" ? NOW - 24 * H : win === "week" ? NOW - 7 * 24 * H : 0;
  const acc = new Map<string, { wins: number; losses: number; profitUsd: number }>();
  for (const m of markets) {
    if (m.data.status === "open" || !m.data.winner) continue;
    const trades = (tradesByMarket[m.data.marketId] ?? []).filter(
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

export const allHandles = (): string[] => {
  const set = new Set<string>();
  for (const m of markets) {
    set.add(m.data.a.handle);
    set.add(m.data.b.handle);
    set.add(m.taggerHandle);
  }
  return [...set].sort();
};
