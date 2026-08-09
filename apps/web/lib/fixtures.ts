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
  taggerHandle: string;
  volumeUsd: number; // gross buys — the historical fact
  netStakedUsd: number; // what is in it right now — feed ranking
  postId: string; // tweet_a_id
}

export const markets: FixtureMarket[] = [
  {
    postId: "p-chart",
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
    taggerHandle: "dave",
    volumeUsd: 620,
    netStakedUsd: 620,
    data: {
      marketId: "m3",
      a: { handle: "opinionhaver", avatarUrl: av("opinionhaver"), text: "cereal is a soup", likes: 3_100, potUsd: 240 },
      b: { handle: "quietkid", avatarUrl: av("quietkid"), text: "no.", likes: 7_450, potUsd: 380 },
      settlesAtMs: NOW + 4 * H + 51 * 60_000,
      status: "open",
    },
  },
  {
    postId: "p-criticism",
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
    taggerHandle: "scout",
    volumeUsd: 115,
    netStakedUsd: 0,
    data: {
      marketId: "m6",
      a: { handle: "deleter", avatarUrl: av("deleter"), text: "watch me say it anyway", likes: 950, potUsd: 75 },
      b: { handle: "witness", avatarUrl: av("witness"), text: "he is absolutely going to delete this", likes: 430, potUsd: 40 },
      settlesAtMs: NOW - H,
      status: "voided",
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
  amountUsd: number;
  atMs: number;
}

/** Position list for the market page (who is on each side, for how much). */
export const tradesByMarket: Record<string, TradeFixture[]> = {
  m2: [
    { handle: "carol", side: "a", amountUsd: 1_200, atMs: NOW - 13 * H },
    { handle: "dave", side: "a", amountUsd: 760, atMs: NOW - 9 * H },
    { handle: "erin", side: "b", amountUsd: 400, atMs: NOW - 11 * H },
    { handle: "fred", side: "b", amountUsd: 240, atMs: NOW - 2 * H },
  ],
  m1: [{ handle: "gary", side: "a", amountUsd: 125, atMs: NOW - 20 * 60_000 }],
  m3: [
    { handle: "carol", side: "a", amountUsd: 240, atMs: NOW - 6 * H },
    { handle: "erin", side: "b", amountUsd: 380, atMs: NOW - 5 * H },
  ],
  m4: [
    { handle: "dave", side: "a", amountUsd: 410, atMs: NOW - 4 * H },
    { handle: "carol", side: "b", amountUsd: 890, atMs: NOW - 3 * H },
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
  const settled = mine.filter((m) => m.data.status === "settled");
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

export const allHandles = (): string[] => {
  const set = new Set<string>();
  for (const m of markets) {
    set.add(m.data.a.handle);
    set.add(m.data.b.handle);
    set.add(m.taggerHandle);
  }
  return [...set].sort();
};
