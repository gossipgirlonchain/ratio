/**
 * Persistence surface. Implementations: InMemoryStore (sim/tests), Supabase
 * later — the engine never sees which. MentionLog idempotency is ported from
 * cue-wire: X mention polling re-shows the same mention, and double-processing
 * means double-spending a bettor's money.
 *
 * The market shape is the generic primitive: two tweets, a deadline, most
 * likes wins. Ratios are its first instance; QT-vs-original and take-vs-take
 * drop in later without a migration.
 */

import { FEE_SHARE_BPS, SWAP_FEE_BPS } from "@ratio/config";

export type PairType = "quote" | "reply";
/**
 * No `voided` status exists (deleted 2026-08-11): treasury seeding makes
 * zero-winner impossible, and an unreadable side settles as a FORFEIT for
 * the side still standing. Every market ends `settled` or `forfeited`.
 */
export type MarketStatus = "open" | "settled" | "forfeited";

export interface MarketRecord {
  /** = tweet_b_id (a reply/QT references exactly one tweet, so B keys the pair). */
  id: string;
  tweetAId: string;
  tweetBId: string;
  authorAXId: string;
  authorBXId: string;
  taggerXId: string;
  pairType: PairType;
  /** Schema accommodation for auto-selected side B (decided 2026-07-30). */
  bSelectedBy: "tagger" | "auto";
  createdAtMs: number;
  settlesAtMs: number; // createdAtMs + 24h
  tweetBAgeAtCreateMs: number; // dominant pricing input; kept for tuning
  likesAAtCreate: number;
  likesBAtCreate: number;
  status: MarketStatus;
  winner: "a" | "b" | null;
  likesAFinal?: number;
  likesBFinal?: number;
  /** Pre-migration odds snapshot — vaults drain at migration (cue-wire keep). */
  finalImpliedA?: number;
  finalPotUsd?: number;
  /** Last likes sample time — drives the sampling cadence (chart series). */
  lastLikesSampleAtMs?: number;
  /**
   * Hidden-reply badge (display only, NEVER settlement input). Reports come
   * from extension clients; the flag goes live at the corroboration
   * threshold. Reporter ids dedupe so one client can't fake independence —
   * real independence enforcement (authed extension identity) lands with R5.
   */
  hiddenReporterIds: string[];
  hiddenReportCount: number;
  /** Set once, when corroboration crossed the threshold and the badge went live. */
  hiddenReportedAtMs?: number;
  cardTweetId?: string;
  chainRefs: { marketId: string };
  dopplerPoolId?: string;
  // display cache only — identity is ALWAYS the numeric X id
  authorAHandle: string;
  authorBHandle: string;
  taggerHandle: string;
}

export interface PostView {
  tweetAId: string;
  marketCount: number; // display only — never a score
  stakedVolumeUsd: number; // the ranking key
}

/**
 * Fee leaderboard row (spec item 9): ONE combined board ranked on total
 * fees earned — never three boards by role, which would show a power user
 * as mediocre three times instead of dominant once. The per-role breakdown
 * renders underneath each row (the character read: mostly-original means
 * someone who gets dunked on constantly, mostly-tagger means a market
 * maker). Windows roll continuously (last 24h / 7d), no clock resets.
 */
export interface FeeLeaderboardRow {
  xUserId: string;
  handle: string; // display cache
  totalFeeUsd: number;
  byRole: { sideA: number; sideB: number; tagger: number };
}

export type TradeDirection = "buy" | "sell";

/**
 * One trade. This is the ONLY time series that exists — no historical
 * state on-chain, vaults drain at settlement — so the market-page chart
 * is reconstructable exactly and only from these rows. Recording cannot
 * be backfilled; fidelity here is load-bearing (site architecture §2).
 * `amountUsd` is the quote leg (in for buys, proceeds for sells);
 * `tokensOut` is the base leg (received for buys, sold for sells).
 */
export interface BetRecord {
  marketId: string;
  xUserId: string;
  handle: string; // display cache
  side: 0 | 1;
  direction: TradeDirection;
  amountUsd: number;
  tokensOut: number;
  placedAtMs: number;
  /** Treasury creation seed: plumbing, not a participant. Excluded from
   * who's-in, positions, and default listBets; counted in staked totals. */
  isSeed?: boolean;
}

/** One point of the chart's likes series — sampled, it exists nowhere else. */
export interface LikeSampleRecord {
  marketId: string;
  atMs: number;
  likesA: number;
  likesB: number;
}

/** A user's net standing in one open market, derived from trade records. */
export interface PositionView {
  marketId: string;
  side: 0 | 1;
  tokens: number;
  /** Net quote in (buys minus sell proceeds) — average entry comes from
   * here too, since entry prices exist nowhere on-chain. */
  netStakedUsd: number;
}

export interface Store {
  /** Returns false if this mention was already processed (idempotency). */
  markMentionProcessed(mentionTweetId: string): Promise<boolean>;
  /** Any status counts — settled pairs never reopen. */
  getMarketByPair(tweetAId: string, tweetBId: string): Promise<MarketRecord | undefined>;
  /** Bet routing: match side A, side B, or the market-card tweet. */
  getMarketByTweet(tweetId: string): Promise<MarketRecord | undefined>;
  saveMarket(market: MarketRecord): Promise<void>;
  updateMarket(id: string, patch: Partial<MarketRecord>): Promise<void>;
  saveBet(bet: BetRecord): Promise<void>;
  /** Participant trades only — seeds are excluded (plumbing). */
  listBets(marketId: string): Promise<BetRecord[]>;
  saveLikeSample(sample: LikeSampleRecord): Promise<void>;
  listLikeSamples(marketId: string): Promise<LikeSampleRecord[]>;
  listOpenMarketsDue(nowMs: number): Promise<MarketRecord[]>;
  /** Open markets whose last likes sample is older than the interval. */
  listOpenMarketsNeedingLikesSample(intervalMs: number, nowMs: number): Promise<MarketRecord[]>;
  /**
   * Post view: every market sharing this side A. A primary read path —
   * `tweet_a_id` is INDEXED in every implementation (Supabase: btree).
   *
   * HARD RULE — no cross-market aggregation, ever. Callers may count these
   * markets ("this post contains 6 markets") and nothing else: no combined
   * score, no "side A is winning", no aggregate pot, no per-post
   * leaderboard. Each market card is fully self-contained (own pot, own
   * clock, own outcome); a post-level winning state read as "I won" is a
   * payout dispute. The count is a count, never a score.
   */
  listMarketsByPost(tweetAId: string): Promise<MarketRecord[]>;
  /**
   * Trending: posts RANKED BY STAKED VOLUME, never by market count —
   * tagging is free and counts are inflatable; volume cannot be faked
   * without spending. `marketCount` rides along for display only.
   */
  trendingPosts(limit: number): Promise<PostView[]>;
  /**
   * Combined fee board over trades since `sinceMs` (fees accrue at swap
   * time in BOTH directions — buys and sells both pay the five recipients,
   * fees earn on churn). Rolling windows: all-time = 0, 24h = now − 24h,
   * weekly = now − 7d. Protocol and Doppler wallets are not rows — this is
   * a user leaderboard.
   */
  feeLeaderboard(opts: { sinceMs: number; limit?: number }): Promise<FeeLeaderboardRow[]>;
  /** Profile page: every market this X id touched, in any of the three roles. */
  listMarketsByParticipant(xUserId: string): Promise<MarketRecord[]>;
  /**
   * Feed: MARKETS ranked by NET CURRENTLY STAKED (all-time buys minus sell
   * proceeds) — what is in the market right now, which is what makes it
   * worth looking at. Gross cumulative buys would keep ranking a market
   * whose losing side already ran for the exit. `sinceMs` filters to
   * markets with any trade activity in the window; the net is always
   * computed over all trades. (Gross buys remain the number for the
   * extension's all-time post volume — a historical fact — via PostView.)
   */
  listMarketsByVolume(opts: { sinceMs: number; limit: number; openOnly?: boolean }): Promise<MarketRecord[]>;
  /** Open positions for a user, net of sells, derived from trade records. */
  openPositionsByUser(xUserId: string): Promise<PositionView[]>;
  /**
   * Instrumentation for the exit-fee ramp: sells inside ±windowMs of each
   * market's ramp start (createdAt + rampStartMs). The smoothstep curve
   * has no cliff to front-run, but if people pile out just before the
   * ramp anyway, this is where it shows.
   */
  sellsNearRampStart(opts: { rampStartMs: number; windowMs: number }): Promise<{ justBefore: number; justAfter: number }>;

}

export class InMemoryStore implements Store {
  private mentions = new Set<string>();
  private markets = new Map<string, MarketRecord>();
  private bets: BetRecord[] = [];
  private likeSamples: LikeSampleRecord[] = [];
  /** The in-memory analogue of the tweet_a_id index. */
  private byPost = new Map<string, string[]>();

  async markMentionProcessed(id: string): Promise<boolean> {
    if (this.mentions.has(id)) return false;
    this.mentions.add(id);
    return true;
  }
  async getMarketByPair(a: string, b: string) {
    for (const m of this.markets.values())
      if (m.tweetAId === a && m.tweetBId === b) return m;
    return undefined;
  }
  async getMarketByTweet(tweetId: string) {
    for (const m of this.markets.values())
      if (
        m.tweetAId === tweetId ||
        m.tweetBId === tweetId ||
        m.cardTweetId === tweetId
      )
        return m;
    return undefined;
  }
  async saveMarket(market: MarketRecord) {
    this.markets.set(market.id, market);
    const ids = this.byPost.get(market.tweetAId) ?? [];
    if (!ids.includes(market.id)) ids.push(market.id);
    this.byPost.set(market.tweetAId, ids);
  }
  async updateMarket(id: string, patch: Partial<MarketRecord>) {
    const m = this.markets.get(id);
    if (m) Object.assign(m, patch);
  }
  async saveBet(bet: BetRecord) {
    this.bets.push(bet);
  }
  async listBets(marketId: string) {
    return this.bets.filter((b) => b.marketId === marketId && !b.isSeed);
  }
  async saveLikeSample(sample: LikeSampleRecord) {
    this.likeSamples.push(sample);
  }
  async listLikeSamples(marketId: string) {
    return this.likeSamples
      .filter((sm) => sm.marketId === marketId)
      .sort((x, y) => x.atMs - y.atMs);
  }
  async listOpenMarketsDue(nowMs: number) {
    return [...this.markets.values()].filter(
      (m) => m.status === "open" && m.settlesAtMs <= nowMs,
    );
  }
  async listOpenMarketsNeedingLikesSample(intervalMs: number, nowMs: number) {
    return [...this.markets.values()].filter(
      (m) =>
        m.status === "open" &&
        nowMs < m.settlesAtMs &&
        nowMs - (m.lastLikesSampleAtMs ?? m.createdAtMs) >= intervalMs,
    );
  }
  async listMarketsByPost(tweetAId: string) {
    return (this.byPost.get(tweetAId) ?? []).map((id) => this.markets.get(id)!);
  }
  async trendingPosts(limit: number) {
    // GROSS buys: the extension's all-time post volume is a historical
    // fact about the post; sells neither add to it nor subtract.
    const volumeByMarket = new Map<string, number>();
    for (const b of this.bets) {
      if (b.direction !== "buy") continue;
      volumeByMarket.set(b.marketId, (volumeByMarket.get(b.marketId) ?? 0) + b.amountUsd);
    }
    const views: PostView[] = [...this.byPost.entries()].map(([tweetAId, ids]) => ({
      tweetAId,
      marketCount: ids.length,
      stakedVolumeUsd: ids.reduce((s, id) => s + (volumeByMarket.get(id) ?? 0), 0),
    }));
    return views
      .sort((x, y) => y.stakedVolumeUsd - x.stakedVolumeUsd)
      .slice(0, limit);
  }
  async feeLeaderboard({ sinceMs, limit = 100 }: { sinceMs: number; limit?: number }) {
    const rows = new Map<string, FeeLeaderboardRow>();
    const credit = (
      xUserId: string,
      handle: string,
      role: keyof FeeLeaderboardRow["byRole"],
      usd: number,
    ) => {
      const row =
        rows.get(xUserId) ??
        ({ xUserId, handle, totalFeeUsd: 0, byRole: { sideA: 0, sideB: 0, tagger: 0 } } satisfies FeeLeaderboardRow);
      row.totalFeeUsd += usd;
      row.byRole[role] += usd;
      rows.set(xUserId, row);
    };
    for (const bet of this.bets) {
      if (bet.placedAtMs < sinceMs) continue;
      const m = this.markets.get(bet.marketId);
      if (!m) continue;
      const fee = (bet.amountUsd * SWAP_FEE_BPS) / 10_000;
      credit(m.authorAXId, m.authorAHandle, "sideA", (fee * FEE_SHARE_BPS.sideA) / 10_000);
      credit(m.authorBXId, m.authorBHandle, "sideB", (fee * FEE_SHARE_BPS.sideB) / 10_000);
      credit(m.taggerXId, m.taggerHandle, "tagger", (fee * FEE_SHARE_BPS.tagger) / 10_000);
    }
    return [...rows.values()]
      .sort((x, y) => y.totalFeeUsd - x.totalFeeUsd)
      .slice(0, limit);
  }
  async listMarketsByParticipant(xUserId: string) {
    return [...this.markets.values()].filter(
      (m) =>
        m.authorAXId === xUserId ||
        m.authorBXId === xUserId ||
        m.taggerXId === xUserId,
    );
  }
  async listMarketsByVolume({
    sinceMs,
    limit,
    openOnly = true,
  }: {
    sinceMs: number;
    limit: number;
    openOnly?: boolean;
  }) {
    const net = new Map<string, number>();
    const active = new Set<string>();
    for (const t of this.bets) {
      const sign = t.direction === "buy" ? 1 : -1;
      net.set(t.marketId, (net.get(t.marketId) ?? 0) + sign * t.amountUsd);
      if (t.placedAtMs >= sinceMs) active.add(t.marketId);
    }
    return [...this.markets.values()]
      .filter((m) => (openOnly ? m.status === "open" : true) && active.has(m.id))
      .sort((x, y) => (net.get(y.id) ?? 0) - (net.get(x.id) ?? 0))
      .slice(0, limit);
  }
  async openPositionsByUser(xUserId: string) {
    const byKey = new Map<string, PositionView>();
    for (const t of this.bets) {
      if (t.xUserId !== xUserId) continue;
      const m = this.markets.get(t.marketId);
      if (!m || m.status !== "open") continue;
      const key = `${t.marketId}:${t.side}`;
      const p =
        byKey.get(key) ??
        ({ marketId: t.marketId, side: t.side, tokens: 0, netStakedUsd: 0 } satisfies PositionView);
      const sign = t.direction === "buy" ? 1 : -1;
      p.tokens += sign * t.tokensOut;
      p.netStakedUsd += sign * t.amountUsd;
      byKey.set(key, p);
    }
    return [...byKey.values()].filter((p) => p.tokens > 1e-9);
  }
  async sellsNearRampStart({ rampStartMs, windowMs }: { rampStartMs: number; windowMs: number }) {
    let justBefore = 0;
    let justAfter = 0;
    for (const t of this.bets) {
      if (t.direction !== "sell") continue;
      const m = this.markets.get(t.marketId);
      if (!m) continue;
      const delta = t.placedAtMs - (m.createdAtMs + rampStartMs);
      if (delta >= -windowMs && delta < 0) justBefore += 1;
      else if (delta >= 0 && delta <= windowMs) justAfter += 1;
    }
    return { justBefore, justAfter };
  }
}
