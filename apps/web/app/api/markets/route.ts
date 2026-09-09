/**
 * The live world in one payload: every market, its trades, its chart
 * series, and the fees leaderboard — shaped exactly like lib/fixtures so
 * the pages swap data sources without a redesign. Server-computed because
 * the service key lives here and the math should have one home.
 *
 * THE JOIN. Two halves meet here and neither can produce the other:
 *
 *  - X data — handles, texts, like counts, who tagged whom — is in our store.
 *    It is not on chain and never will be.
 *  - Money — pots, entry prices, trades, fees, the pot itself — comes from
 *    the subgraph. It is not readable from chain either: v4 is a singleton,
 *    the pools drain at migration, and no contract ever recorded what a
 *    position cost.
 *
 * The key is the side-B tweet id: our market's primary key, and the
 * `marketId` the oracle emits at creation. When the index is unreachable the
 * money falls back to our own bet records and the payload says `source:
 * "store"`, because that number is strictly worse — it cannot see a bet
 * placed directly on chain — and pretending otherwise would be a lie about
 * where the number came from.
 */
import { NextResponse } from "next/server";

import type { ChartSeries, FixtureMarket, LeaderRow, TradeFixture } from "../../../lib/fixtures";
import { indexedMoney, shortAddress } from "../../../lib/subgraph";
import { supabaseAdmin } from "../../../lib/supabaseServer";

export const dynamic = "force-dynamic";

const SWAP_FEE = 0.0125;
const FEE_SHARE = { sideA: 0.18, sideB: 0.18, tagger: 0.115 } as const;

const av = (h: string) => `https://unavatar.io/x/${h}`;

interface MarketRow {
  id: string;
  tweet_a_id: string;
  tweet_b_id: string;
  pair_type: "reply" | "quote";
  created_at_ms: number;
  settles_at_ms: number;
  likes_a_at_create: number;
  likes_b_at_create: number;
  status: string;
  winner: "a" | "b" | null;
  likes_a_final: number | null;
  likes_b_final: number | null;
  hidden_report_count: number;
  author_a_handle: string;
  author_b_handle: string;
  tagger_handle: string;
  text_a: string | null;
  text_b: string | null;
}
interface BetRow {
  market_id: string;
  handle: string;
  side: number;
  direction: string;
  amount_usd: number;
  placed_at_ms: number;
  is_seed: boolean;
}
/** One entry into a market, from whichever source is authoritative. */
interface MoneyEvent {
  handle: string;
  side: 0 | 1;
  amountUsd: number;
  atMs: number;
  isSeed: boolean;
}

interface SampleRow {
  market_id: string;
  at_ms: number;
  likes_a: number;
  likes_b: number;
}

export async function GET() {
  const db = supabaseAdmin();
  const [mkts, bets, samples, money] = await Promise.all([
    db.from("markets").select("*").order("created_at_ms", { ascending: false }),
    db.from("bets").select("*").order("placed_at_ms", { ascending: true }),
    db.from("like_samples").select("*").order("at_ms", { ascending: true }),
    indexedMoney(),
  ]);
  const err = mkts.error ?? bets.error ?? samples.error;
  if (err) return NextResponse.json({ error: err.message }, { status: 500 });

  const betRows = (bets.data ?? []) as BetRow[];
  const sampleRows = (samples.data ?? []) as SampleRow[];
  const markets: FixtureMarket[] = [];
  const tradesByMarket: Record<string, TradeFixture[]> = {};
  const seriesByMarket: Record<string, ChartSeries> = {};
  const fees = new Map<string, LeaderRow>();

  const credit = (handle: string, role: keyof LeaderRow["byRole"], usd: number, atMs: number) => {
    if (usd <= 0) return;
    const row = fees.get(handle) ?? { handle, totalFeeUsd: 0, byRole: { original: 0, reply: 0, tagger: 0 } };
    row.totalFeeUsd += usd;
    row.byRole[role] += usd;
    fees.set(handle, row);
    void atMs; // windows (day/week) can slice later; all-time for now
  };

  for (const m of (mkts.data ?? []) as MarketRow[]) {
    const mySamples = sampleRows.filter((s) => s.market_id === m.id);
    const indexed = money?.markets.get(m.id);

    /**
     * ONE list of money events per market, from ONE source. Pots, the trade
     * list, the chart's bars and the fee accrual are all folded over this, so
     * there is no path where the chart disagrees with the pot because they
     * read different tables.
     */
    const events: MoneyEvent[] = money && indexed
      ? (money.tradesByMarket.get(m.id) ?? []).map((t) => ({
          handle: money.handleFor(t.bettor) ?? shortAddress(t.bettor),
          side: t.side,
          amountUsd: money.usd(t.amountInWei),
          atMs: t.atMs,
          isSeed: false,
        }))
      : betRows
          .filter((b) => b.market_id === m.id)
          .map((b) => ({
            handle: b.handle,
            side: b.side === 0 ? 0 : 1,
            amountUsd: Number(b.amount_usd),
            atMs: Number(b.placed_at_ms),
            isSeed: b.is_seed,
          }));
    const real = events.filter((e) => !e.isSeed);

    // Pots come from the indexed per-side totals when we have them: `staked`
    // is every swap that ever hit that side's pool, where our trade list is
    // capped at the most recent page of them.
    const sumSide = (side: 0 | 1) =>
      events.filter((e) => e.side === side).reduce((s, e) => s + e.amountUsd, 0);
    const potA = indexed && money ? money.usd(indexed.stakedWei[0]) : sumSide(0);
    const potB = indexed && money ? money.usd(indexed.stakedWei[1]) : sumSide(1);

    const last = mySamples[mySamples.length - 1];
    const likesA = m.likes_a_final ?? last?.likes_a ?? m.likes_a_at_create;
    const likesB = m.likes_b_final ?? last?.likes_b ?? m.likes_b_at_create;
    const status = m.status as FixtureMarket["data"]["status"];

    markets.push({
      postId: m.tweet_a_id,
      pairType: m.pair_type,
      taggerHandle: m.tagger_handle,
      volumeUsd: potA + potB,
      netStakedUsd: indexed && money ? money.usd(indexed.netStakedWei) : potA + potB,
      data: {
        marketId: m.id,
        a: { handle: m.author_a_handle, avatarUrl: av(m.author_a_handle), text: m.text_a ?? "", likes: likesA, potUsd: potA, tweetUrl: `https://x.com/${m.author_a_handle}/status/${m.tweet_a_id}` },
        b: { handle: m.author_b_handle, avatarUrl: av(m.author_b_handle), text: m.text_b ?? "", likes: likesB, potUsd: potB, tweetUrl: `https://x.com/${m.author_b_handle}/status/${m.tweet_b_id}` },
        settlesAtMs: Number(m.settles_at_ms),
        status,
        winner: m.winner ?? undefined,
        hiddenFromThread: m.hidden_report_count > 0 ? true : undefined,
      },
    });

    tradesByMarket[m.id] = real.map((e) => ({
      handle: e.handle,
      side: e.side === 0 ? "a" : "b",
      // Sells are protocol-impossible: the hook rejects them in every oracle
      // state. Every money event is an entry.
      direction: "buy" as const,
      amountUsd: e.amountUsd,
      atMs: e.atMs,
    }));

    // Chart: sample timeline anchored at creation; money bucketed to the
    // nearest tick. Sparse early markets get sparse charts — honest.
    const ts = [Number(m.created_at_ms), ...mySamples.map((s) => Number(s.at_ms))];
    const lA = [m.likes_a_at_create, ...mySamples.map((s) => s.likes_a)];
    const lB = [m.likes_b_at_create, ...mySamples.map((s) => s.likes_b)];
    const buyA = ts.map(() => 0);
    const buyB = ts.map(() => 0);
    for (const e of events) {
      let i = 0;
      for (let j = 1; j < ts.length; j++) {
        if (Math.abs(ts[j]! - e.atMs) < Math.abs(ts[i]! - e.atMs)) i = j;
      }
      (e.side === 0 ? buyA : buyB)[i]! += e.amountUsd;
    }
    seriesByMarket[m.id] = { ts, likesA: lA, likesB: lB, buyA, buyB, sellA: ts.map(() => 0), sellB: ts.map(() => 0) };

    // Entry fees accrue to the three public roles the moment a buy lands.
    for (const e of real) {
      const fee = e.amountUsd * SWAP_FEE;
      credit(m.author_a_handle, "original", fee * FEE_SHARE.sideA, e.atMs);
      credit(m.author_b_handle, "reply", fee * FEE_SHARE.sideB, e.atMs);
      credit(m.tagger_handle, "tagger", fee * FEE_SHARE.tagger, e.atMs);
    }
  }

  const leaderboard = [...fees.values()].sort((a, b) => b.totalFeeUsd - a.totalFeeUsd);
  return NextResponse.json({
    markets,
    tradesByMarket,
    seriesByMarket,
    leaderboard,
    // Where the money numbers came from. Not decoration: "store" means the
    // index was unreachable and these totals can only see bets we brokered.
    source: money ? "subgraph" : "store",
  });
}
