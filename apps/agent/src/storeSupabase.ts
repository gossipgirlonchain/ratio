/**
 * Supabase-backed Store (migrations/0001_init.sql). The engine never
 * knows which store it holds — same seam as InMemoryStore.
 *
 * Design choice, deliberate: simple lookups map straight to SQL, but the
 * AGGREGATE queries (leaderboards, trending, volume ranking, positions)
 * hydrate an InMemoryStore with the fetched rows and delegate to it.
 * That keeps one implementation of the ranking semantics — the one the
 * sim proves — so the two stores cannot drift. When row counts make
 * full-fetch too heavy, individual aggregates graduate to SQL views;
 * until then, correctness beats cleverness.
 *
 * Auth model: constructed with the SERVICE ROLE key (bypasses RLS) in
 * the agent. The public web reads through RLS with the publishable key.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import {
  InMemoryStore,
  type BetRecord,
  type LikeSampleRecord,
  type MarketRecord,
  type Store,
} from "./store.js";

// --- row mapping ------------------------------------------------------------

type MarketRow = Record<string, unknown>;

const toRow = (m: MarketRecord): MarketRow => ({
  id: m.id,
  tweet_a_id: m.tweetAId,
  tweet_b_id: m.tweetBId,
  author_a_x_id: m.authorAXId,
  author_b_x_id: m.authorBXId,
  tagger_x_id: m.taggerXId,
  pair_type: m.pairType,
  b_selected_by: m.bSelectedBy,
  created_at_ms: m.createdAtMs,
  settles_at_ms: m.settlesAtMs,
  tweet_b_age_at_create_ms: m.tweetBAgeAtCreateMs,
  likes_a_at_create: m.likesAAtCreate,
  likes_b_at_create: m.likesBAtCreate,
  status: m.status,
  winner: m.winner,
  likes_a_final: m.likesAFinal ?? null,
  likes_b_final: m.likesBFinal ?? null,
  final_implied_a: m.finalImpliedA ?? null,
  final_pot_usd: m.finalPotUsd ?? null,
  last_likes_sample_at_ms: m.lastLikesSampleAtMs ?? null,
  hidden_reporter_ids: m.hiddenReporterIds,
  hidden_report_count: m.hiddenReportCount,
  hidden_reported_at_ms: m.hiddenReportedAtMs ?? null,
  card_tweet_id: m.cardTweetId ?? null,
  chain_refs: m.chainRefs,
  doppler_pool_id: m.dopplerPoolId ?? null,
  author_a_handle: m.authorAHandle,
  author_b_handle: m.authorBHandle,
  tagger_handle: m.taggerHandle,
  text_a: m.textA ?? null,
  text_b: m.textB ?? null,
});

const numOrUndef = (v: unknown): number | undefined =>
  v === null || v === undefined ? undefined : Number(v);

const fromRow = (r: MarketRow): MarketRecord => ({
  id: r.id as string,
  tweetAId: r.tweet_a_id as string,
  tweetBId: r.tweet_b_id as string,
  authorAXId: r.author_a_x_id as string,
  authorBXId: r.author_b_x_id as string,
  taggerXId: r.tagger_x_id as string,
  pairType: r.pair_type as MarketRecord["pairType"],
  bSelectedBy: r.b_selected_by as MarketRecord["bSelectedBy"],
  createdAtMs: Number(r.created_at_ms),
  settlesAtMs: Number(r.settles_at_ms),
  tweetBAgeAtCreateMs: Number(r.tweet_b_age_at_create_ms),
  likesAAtCreate: Number(r.likes_a_at_create),
  likesBAtCreate: Number(r.likes_b_at_create),
  status: r.status as MarketRecord["status"],
  winner: (r.winner ?? null) as MarketRecord["winner"],
  likesAFinal: numOrUndef(r.likes_a_final),
  likesBFinal: numOrUndef(r.likes_b_final),
  finalImpliedA: numOrUndef(r.final_implied_a),
  finalPotUsd: numOrUndef(r.final_pot_usd),
  lastLikesSampleAtMs: numOrUndef(r.last_likes_sample_at_ms),
  hiddenReporterIds: (r.hidden_reporter_ids ?? []) as string[],
  hiddenReportCount: Number(r.hidden_report_count ?? 0),
  hiddenReportedAtMs: numOrUndef(r.hidden_reported_at_ms),
  cardTweetId: (r.card_tweet_id ?? undefined) as string | undefined,
  chainRefs: r.chain_refs as MarketRecord["chainRefs"],
  dopplerPoolId: (r.doppler_pool_id ?? undefined) as string | undefined,
  authorAHandle: r.author_a_handle as string,
  authorBHandle: r.author_b_handle as string,
  taggerHandle: r.tagger_handle as string,
  textA: (r.text_a ?? undefined) as string | undefined,
  textB: (r.text_b ?? undefined) as string | undefined,
});

const betToRow = (b: BetRecord) => ({
  market_id: b.marketId,
  x_user_id: b.xUserId,
  handle: b.handle,
  side: b.side,
  direction: b.direction,
  amount_usd: b.amountUsd,
  tokens_out: b.tokensOut,
  placed_at_ms: b.placedAtMs,
  is_seed: b.isSeed ?? false,
});

const betFromRow = (r: Record<string, unknown>): BetRecord => ({
  marketId: r.market_id as string,
  xUserId: r.x_user_id as string,
  handle: r.handle as string,
  side: Number(r.side) as 0 | 1,
  direction: r.direction as BetRecord["direction"],
  amountUsd: Number(r.amount_usd),
  tokensOut: Number(r.tokens_out),
  placedAtMs: Number(r.placed_at_ms),
  isSeed: Boolean(r.is_seed),
});

const sampleFromRow = (r: Record<string, unknown>): LikeSampleRecord => ({
  marketId: r.market_id as string,
  atMs: Number(r.at_ms),
  likesA: Number(r.likes_a),
  likesB: Number(r.likes_b),
});

const fail = (op: string, error: { message: string } | null): never => {
  throw new Error(`supabase ${op}: ${error?.message ?? "unknown error"}`);
};

// --- store ------------------------------------------------------------------

export class SupabaseStore implements Store {
  private db: SupabaseClient;

  constructor(url: string, serviceRoleKey: string) {
    this.db = createClient(url, serviceRoleKey, {
      auth: { persistSession: false },
    });
  }

  async markMentionProcessed(mentionTweetId: string): Promise<boolean> {
    const { data, error } = await this.db
      .from("mentions_processed")
      .upsert(
        { mention_tweet_id: mentionTweetId, processed_at_ms: Date.now() },
        { onConflict: "mention_tweet_id", ignoreDuplicates: true },
      )
      .select();
    if (error) fail("markMentionProcessed", error);
    return (data ?? []).length > 0; // empty = already processed
  }

  async getMarketByPair(tweetAId: string, tweetBId: string) {
    const { data, error } = await this.db
      .from("markets")
      .select()
      .eq("tweet_a_id", tweetAId)
      .eq("tweet_b_id", tweetBId)
      .maybeSingle();
    if (error) fail("getMarketByPair", error);
    return data ? fromRow(data) : undefined;
  }

  async getMarketByTweet(tweetId: string) {
    const { data, error } = await this.db
      .from("markets")
      .select()
      .or(`tweet_a_id.eq.${tweetId},tweet_b_id.eq.${tweetId},card_tweet_id.eq.${tweetId}`)
      .limit(1)
      .maybeSingle();
    if (error) fail("getMarketByTweet", error);
    return data ? fromRow(data) : undefined;
  }

  async saveMarket(market: MarketRecord): Promise<void> {
    const { error } = await this.db.from("markets").upsert(toRow(market));
    if (error) fail("saveMarket", error);
  }

  async updateMarket(id: string, patch: Partial<MarketRecord>): Promise<void> {
    // map only the provided camelCase fields onto columns
    const full = toRow({ ...(patch as MarketRecord), id });
    const row: MarketRow = {};
    const provided = new Set(Object.keys(patch));
    const columnFor: Record<string, string> = {
      status: "status", winner: "winner", likesAFinal: "likes_a_final",
      likesBFinal: "likes_b_final", finalImpliedA: "final_implied_a",
      finalPotUsd: "final_pot_usd", lastLikesSampleAtMs: "last_likes_sample_at_ms",
      hiddenReporterIds: "hidden_reporter_ids", hiddenReportCount: "hidden_report_count",
      hiddenReportedAtMs: "hidden_reported_at_ms", cardTweetId: "card_tweet_id",
      dopplerPoolId: "doppler_pool_id", settlesAtMs: "settles_at_ms",
      authorAHandle: "author_a_handle", authorBHandle: "author_b_handle",
      taggerHandle: "tagger_handle",
    };
    for (const k of provided) {
      const col = columnFor[k];
      if (col) row[col] = full[col];
    }
    if (Object.keys(row).length === 0) return;
    const { error } = await this.db.from("markets").update(row).eq("id", id);
    if (error) fail("updateMarket", error);
  }

  async saveBet(bet: BetRecord): Promise<void> {
    const { error } = await this.db.from("bets").insert(betToRow(bet));
    if (error) fail("saveBet", error);
  }

  async listBets(marketId: string): Promise<BetRecord[]> {
    const { data, error } = await this.db
      .from("bets")
      .select()
      .eq("market_id", marketId)
      .eq("is_seed", false) // seeds are plumbing, never participants
      .order("placed_at_ms");
    if (error) fail("listBets", error);
    return (data ?? []).map(betFromRow);
  }

  async saveLikeSample(sample: LikeSampleRecord): Promise<void> {
    const { error } = await this.db.from("like_samples").insert({
      market_id: sample.marketId,
      at_ms: sample.atMs,
      likes_a: sample.likesA,
      likes_b: sample.likesB,
    });
    if (error) fail("saveLikeSample", error);
  }

  async listLikeSamples(marketId: string): Promise<LikeSampleRecord[]> {
    const { data, error } = await this.db
      .from("like_samples")
      .select()
      .eq("market_id", marketId)
      .order("at_ms");
    if (error) fail("listLikeSamples", error);
    return (data ?? []).map(sampleFromRow);
  }

  async listOpenMarketsDue(nowMs: number): Promise<MarketRecord[]> {
    const { data, error } = await this.db
      .from("markets")
      .select()
      .eq("status", "open")
      .lte("settles_at_ms", nowMs);
    if (error) fail("listOpenMarketsDue", error);
    return (data ?? []).map(fromRow);
  }

  async listOpenMarketsNeedingLikesSample(intervalMs: number, nowMs: number): Promise<MarketRecord[]> {
    const cutoff = nowMs - intervalMs;
    // cadence anchors on lastLikesSampleAtMs ?? createdAtMs (store contract)
    const { data, error } = await this.db
      .from("markets")
      .select()
      .eq("status", "open")
      .or(
        `last_likes_sample_at_ms.lte.${cutoff},and(last_likes_sample_at_ms.is.null,created_at_ms.lte.${cutoff})`,
      );
    if (error) fail("listOpenMarketsNeedingLikesSample", error);
    return (data ?? []).map(fromRow);
  }

  async listMarketsByPost(tweetAId: string): Promise<MarketRecord[]> {
    const { data, error } = await this.db
      .from("markets")
      .select()
      .eq("tweet_a_id", tweetAId)
      .order("created_at_ms");
    if (error) fail("listMarketsByPost", error);
    return (data ?? []).map(fromRow);
  }

  async listMarketsByParticipant(xUserId: string): Promise<MarketRecord[]> {
    const { data, error } = await this.db
      .from("markets")
      .select()
      .or(`author_a_x_id.eq.${xUserId},author_b_x_id.eq.${xUserId},tagger_x_id.eq.${xUserId}`)
      .order("created_at_ms");
    if (error) fail("listMarketsByParticipant", error);
    return (data ?? []).map(fromRow);
  }

  // --- aggregates: hydrate the in-memory implementation and delegate.
  // ONE copy of the ranking semantics (the sim-proven one); SQL views can
  // replace individual delegates when scale demands, behind this seam.

  private async hydrate(): Promise<InMemoryStore> {
    const [markets, bets] = await Promise.all([
      this.db.from("markets").select(),
      this.db.from("bets").select(),
    ]);
    if (markets.error) fail("hydrate markets", markets.error);
    if (bets.error) fail("hydrate bets", bets.error);
    const mem = new InMemoryStore();
    for (const r of markets.data ?? []) await mem.saveMarket(fromRow(r));
    for (const r of bets.data ?? []) await mem.saveBet(betFromRow(r));
    return mem;
  }

  async trendingPosts(limit: number) {
    return (await this.hydrate()).trendingPosts(limit);
  }

  async feeLeaderboard(opts: { sinceMs: number; limit?: number }) {
    return (await this.hydrate()).feeLeaderboard(opts);
  }

  async traderLeaderboard(opts: { sinceMs: number; limit?: number }) {
    return (await this.hydrate()).traderLeaderboard(opts);
  }

  async listMarketsByVolume(opts: { sinceMs: number; limit: number; openOnly?: boolean }) {
    return (await this.hydrate()).listMarketsByVolume(opts);
  }

  async openPositionsByUser(xUserId: string) {
    return (await this.hydrate()).openPositionsByUser(xUserId);
  }

  async sellsNearRampStart(opts: { rampStartMs: number; windowMs: number }) {
    return (await this.hydrate()).sellsNearRampStart(opts);
  }
}
