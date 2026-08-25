/**
 * The live world in one payload: every market, its trades, its chart
 * series, and the fees leaderboard — shaped exactly like lib/fixtures so
 * the pages swap data sources without a redesign. Server-computed because
 * the service key lives here and the math should have one home.
 */
import { NextResponse } from "next/server";

import type { ChartSeries, FixtureMarket, LeaderRow, TradeFixture } from "../../../lib/fixtures";
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
interface SampleRow {
  market_id: string;
  at_ms: number;
  likes_a: number;
  likes_b: number;
}

export async function GET() {
  const db = supabaseAdmin();
  const [mkts, bets, samples] = await Promise.all([
    db.from("markets").select("*").order("created_at_ms", { ascending: false }),
    db.from("bets").select("*").order("placed_at_ms", { ascending: true }),
    db.from("like_samples").select("*").order("at_ms", { ascending: true }),
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
    const myBets = betRows.filter((b) => b.market_id === m.id);
    const mySamples = sampleRows.filter((s) => s.market_id === m.id);
    const potA = myBets.filter((b) => b.side === 0).reduce((s, b) => s + Number(b.amount_usd), 0);
    const potB = myBets.filter((b) => b.side === 1).reduce((s, b) => s + Number(b.amount_usd), 0);
    const last = mySamples[mySamples.length - 1];
    const likesA = m.likes_a_final ?? last?.likes_a ?? m.likes_a_at_create;
    const likesB = m.likes_b_final ?? last?.likes_b ?? m.likes_b_at_create;
    const status = m.status as FixtureMarket["data"]["status"];

    markets.push({
      postId: m.tweet_a_id,
      pairType: m.pair_type,
      taggerHandle: m.tagger_handle,
      volumeUsd: potA + potB,
      netStakedUsd: potA + potB,
      data: {
        marketId: m.id,
        a: { handle: m.author_a_handle, avatarUrl: av(m.author_a_handle), text: m.text_a ?? "", likes: likesA, potUsd: potA },
        b: { handle: m.author_b_handle, avatarUrl: av(m.author_b_handle), text: m.text_b ?? "", likes: likesB, potUsd: potB },
        settlesAtMs: Number(m.settles_at_ms),
        status,
        winner: m.winner ?? undefined,
        hiddenFromThread: m.hidden_report_count > 0 ? true : undefined,
      },
    });

    tradesByMarket[m.id] = myBets
      .filter((b) => !b.is_seed)
      .map((b) => ({
        handle: b.handle,
        side: b.side === 0 ? "a" : "b",
        direction: b.direction as "buy" | "sell",
        amountUsd: Number(b.amount_usd),
        atMs: Number(b.placed_at_ms),
      }));

    // Chart: sample timeline anchored at creation; money bucketed to the
    // nearest tick. Sparse early markets get sparse charts — honest.
    const ts = [Number(m.created_at_ms), ...mySamples.map((s) => Number(s.at_ms))];
    const lA = [m.likes_a_at_create, ...mySamples.map((s) => s.likes_a)];
    const lB = [m.likes_b_at_create, ...mySamples.map((s) => s.likes_b)];
    const buyA = ts.map(() => 0);
    const buyB = ts.map(() => 0);
    for (const b of myBets) {
      let i = 0;
      for (let j = 1; j < ts.length; j++) {
        if (Math.abs(ts[j]! - Number(b.placed_at_ms)) < Math.abs(ts[i]! - Number(b.placed_at_ms))) i = j;
      }
      (b.side === 0 ? buyA : buyB)[i]! += Number(b.amount_usd);
    }
    seriesByMarket[m.id] = { ts, likesA: lA, likesB: lB, buyA, buyB, sellA: ts.map(() => 0), sellB: ts.map(() => 0) };

    // Entry fees accrue to the three public roles the moment a buy lands.
    for (const b of myBets.filter((x) => !x.is_seed)) {
      const fee = Number(b.amount_usd) * SWAP_FEE;
      credit(m.author_a_handle, "original", fee * FEE_SHARE.sideA, Number(b.placed_at_ms));
      credit(m.author_b_handle, "reply", fee * FEE_SHARE.sideB, Number(b.placed_at_ms));
      credit(m.tagger_handle, "tagger", fee * FEE_SHARE.tagger, Number(b.placed_at_ms));
    }
  }

  const leaderboard = [...fees.values()].sort((a, b) => b.totalFeeUsd - a.totalFeeUsd);
  return NextResponse.json({ markets, tradesByMarket, seriesByMarket, leaderboard });
}
