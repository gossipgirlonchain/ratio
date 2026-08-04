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
/** `forfeited` is reserved in the schema; nothing sets it in v1 (no hide detection). */
export type MarketStatus = "open" | "settled" | "voided" | "forfeited";

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
  voidReason?: string;
  /** Pre-migration odds snapshot — vaults drain at migration (cue-wire keep). */
  finalImpliedA?: number;
  finalPotUsd?: number;
  healthCheckedAtMs?: number;
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

export interface BetRecord {
  marketId: string;
  xUserId: string;
  handle: string; // display cache
  side: 0 | 1;
  amountUsd: number;
  tokensOut: number;
  placedAtMs: number;
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
  listBets(marketId: string): Promise<BetRecord[]>;
  listOpenMarketsDue(nowMs: number): Promise<MarketRecord[]>;
  listOpenMarketsNeedingHealthCheck(cutoffFractionMs: (m: MarketRecord) => number, nowMs: number): Promise<MarketRecord[]>;
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
   * Combined fee board over bets placed since `sinceMs` (fees accrue at
   * swap time, so the bet timestamp is the window key). Rolling windows:
   * all-time = 0, 24h = now − 24h, weekly = now − 7d. Protocol and Doppler
   * wallets are not rows — this is a user leaderboard.
   */
  feeLeaderboard(opts: { sinceMs: number; limit?: number }): Promise<FeeLeaderboardRow[]>;
  /** Instrumentation for the freshness-window decision (9-12h keep or cut). */
  voidRateByAgeBucket(bucketMs: number): Promise<Map<number, { total: number; voided: number }>>;
}

export class InMemoryStore implements Store {
  private mentions = new Set<string>();
  private markets = new Map<string, MarketRecord>();
  private bets: BetRecord[] = [];
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
    return this.bets.filter((b) => b.marketId === marketId);
  }
  async listOpenMarketsDue(nowMs: number) {
    return [...this.markets.values()].filter(
      (m) => m.status === "open" && m.settlesAtMs <= nowMs,
    );
  }
  async listOpenMarketsNeedingHealthCheck(
    cutoff: (m: MarketRecord) => number,
    nowMs: number,
  ) {
    return [...this.markets.values()].filter(
      (m) =>
        m.status === "open" &&
        m.healthCheckedAtMs === undefined &&
        nowMs >= cutoff(m) &&
        nowMs < m.settlesAtMs,
    );
  }
  async listMarketsByPost(tweetAId: string) {
    return (this.byPost.get(tweetAId) ?? []).map((id) => this.markets.get(id)!);
  }
  async trendingPosts(limit: number) {
    const volumeByMarket = new Map<string, number>();
    for (const b of this.bets)
      volumeByMarket.set(b.marketId, (volumeByMarket.get(b.marketId) ?? 0) + b.amountUsd);
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
  async voidRateByAgeBucket(bucketMs: number) {
    const out = new Map<number, { total: number; voided: number }>();
    for (const m of this.markets.values()) {
      const bucket = Math.floor(m.tweetBAgeAtCreateMs / bucketMs);
      const row = out.get(bucket) ?? { total: 0, voided: 0 };
      row.total += 1;
      if (m.status === "voided") row.voided += 1;
      out.set(bucket, row);
    }
    return out;
  }
}
