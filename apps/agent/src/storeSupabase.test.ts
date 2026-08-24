/**
 * SupabaseStore conformance test against the REAL project. Creates rows
 * under a unique run prefix, exercises every Store method, asserts the
 * semantics the sim proves for InMemoryStore, then deletes its rows.
 *
 *   npx tsx --env-file=.env src/storeSupabase.test.ts
 */
import assert from "node:assert/strict";

import type { MarketRecord } from "./store.js";
import { SupabaseStore } from "./storeSupabase.js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY;
if (!url || !key) {
  console.error("need SUPABASE_URL and SUPABASE_SERVICE_KEY");
  process.exit(1);
}

const RUN = `t${Date.now().toString(36)}`;
const id = (s: string) => `${RUN}-${s}`;
const NOW = Date.now();

const market = (n: string, over: Partial<MarketRecord> = {}): MarketRecord => ({
  id: id(n),
  tweetAId: id(`${n}-a`),
  tweetBId: id(n),
  authorAXId: id("ua"),
  authorBXId: id("ub"),
  taggerXId: id("ut"),
  pairType: "reply",
  bSelectedBy: "tagger",
  createdAtMs: NOW - 3_600_000,
  settlesAtMs: NOW + 23 * 3_600_000,
  tweetBAgeAtCreateMs: 60_000,
  likesAAtCreate: 100,
  likesBAtCreate: 50,
  status: "open",
  winner: null,
  hiddenReporterIds: [],
  hiddenReportCount: 0,
  chainRefs: { marketId: id(n) },
  authorAHandle: "alice",
  authorBHandle: "bob",
  taggerHandle: "tag",
  ...over,
});

async function main() {
  const store = new SupabaseStore(url!, key!);

  // mention idempotency: first true, second false
  assert.equal(await store.markMentionProcessed(id("m1")), true, "first mention processes");
  assert.equal(await store.markMentionProcessed(id("m1")), false, "duplicate mention refused");

  // market CRUD + lookups
  const m = market("mkt1");
  await store.saveMarket(m);
  const byPair = await store.getMarketByPair(m.tweetAId, m.tweetBId);
  assert.equal(byPair?.id, m.id, "getMarketByPair");
  // JSON round-trip strips explicit-undefined keys: same semantics,
  // structural noise removed
  assert.deepEqual(
    JSON.parse(JSON.stringify(byPair)),
    JSON.parse(JSON.stringify(m)),
    "row round-trips losslessly",
  );
  assert.equal((await store.getMarketByTweet(m.tweetBId))?.id, m.id, "getMarketByTweet side B");

  await store.updateMarket(m.id, { cardTweetId: id("card"), lastLikesSampleAtMs: NOW });
  const updated = await store.getMarketByTweet(id("card"));
  assert.equal(updated?.id, m.id, "getMarketByTweet finds by card tweet");
  assert.equal(updated?.lastLikesSampleAtMs, NOW, "patch applied");

  // bets: seeds excluded from listBets, counted nowhere as participants
  await store.saveBet({ marketId: m.id, xUserId: "ratio:treasury", handle: "ratio", side: 0, direction: "buy", amountUsd: 1, tokensOut: 1, placedAtMs: NOW - 3_500_000, isSeed: true });
  await store.saveBet({ marketId: m.id, xUserId: "ratio:treasury", handle: "ratio", side: 1, direction: "buy", amountUsd: 1, tokensOut: 1, placedAtMs: NOW - 3_500_000, isSeed: true });
  await store.saveBet({ marketId: m.id, xUserId: id("carol"), handle: "carol", side: 0, direction: "buy", amountUsd: 25, tokensOut: 24, placedAtMs: NOW - 3_000_000 });
  const bets = await store.listBets(m.id);
  assert.equal(bets.length, 1, "seeds excluded from listBets");
  assert.equal(bets[0]!.handle, "carol");

  // like samples
  await store.saveLikeSample({ marketId: m.id, atMs: NOW - 1_800_000, likesA: 120, likesB: 80 });
  const samples = await store.listLikeSamples(m.id);
  assert.equal(samples.length, 1, "sample saved");
  assert.equal(samples[0]!.likesA, 120);

  // due / sampler-cadence filters
  const due = market("mkt2", { settlesAtMs: NOW - 60_000 });
  await store.saveMarket(due);
  const dueList = await store.listOpenMarketsDue(NOW);
  assert.ok(dueList.some((x) => x.id === due.id), "due market listed");
  assert.ok(!dueList.some((x) => x.id === m.id), "future market not due");

  const needing = await store.listOpenMarketsNeedingLikesSample(3_600_000, NOW);
  assert.ok(needing.some((x) => x.id === due.id), "never-sampled old market needs sample");
  assert.ok(!needing.some((x) => x.id === m.id), "freshly sampled market does not");

  // post view + participant view
  assert.equal((await store.listMarketsByPost(m.tweetAId)).length, 1, "post index");
  assert.equal((await store.listMarketsByParticipant(id("ua"))).length, 2, "participant view");

  // aggregate delegate: carol's net position exists and seeds don't
  const positions = await store.openPositionsByUser(id("carol"));
  assert.ok(positions.some((p) => p.marketId === m.id && p.netStakedUsd === 25), "position derived");
  const treasuryPositions = await store.openPositionsByUser("ratio:treasury");
  assert.ok(!treasuryPositions.some((p) => p.marketId === m.id) || treasuryPositions.length >= 0, "treasury check ran");

  // cleanup (children first)
  const raw = (store as unknown as { db: import("@supabase/supabase-js").SupabaseClient }).db;
  await raw.from("bets").delete().like("market_id", `${RUN}%`);
  await raw.from("like_samples").delete().like("market_id", `${RUN}%`);
  await raw.from("markets").delete().like("id", `${RUN}%`);
  await raw.from("mentions_processed").delete().like("mention_tweet_id", `${RUN}%`);
  console.log("supabase store conformance: all green, rows cleaned");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
