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
  /** Instrumentation for the freshness-window decision (9-12h keep or cut). */
  voidRateByAgeBucket(bucketMs: number): Promise<Map<number, { total: number; voided: number }>>;
}

export class InMemoryStore implements Store {
  private mentions = new Set<string>();
  private markets = new Map<string, MarketRecord>();
  private bets: BetRecord[] = [];

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
