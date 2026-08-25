/**
 * Scripted end-to-end sim: fake X, fake clock, mock chain with parimutuel
 * semantics. Proves R1 before any real surface exists. Run: npm run sim
 */
import assert from "node:assert/strict";

import {
  BOT_HANDLE,
  EXIT_FEE_MAX_BPS,
  EXIT_FEE_RAMP_START_MS,
  FEE_SHARE_BPS,
  FRESHNESS_WINDOW_MS,
  LIKES_SAMPLE_INTERVAL_MS,
  HIDDEN_REPORT_THRESHOLD,
  MARKET_DURATION_MS,
  MAX_STAKE_USD,
  MIN_STAKE_USD,
  SEED_PER_SIDE_USD,
  SWAP_FEE_BPS,
  exitFeeBps,
  marketUrl,
} from "@ratio/config";

import { MockMarketChain } from "./chain.js";
import { RatioEngine } from "./engine.js";
import { InMemoryStore } from "./store.js";
import { MockWalletProvider } from "./wallets.js";
import { MockXClient, type XTweet } from "./x.js";

// --- fake clock -------------------------------------------------------------
let simNow = Date.UTC(2026, 6, 31, 12, 0, 0);
const clock = () => simNow;
const advance = (ms: number) => (simNow += ms);
const HOUR = 60 * 60 * 1000;

// --- world ------------------------------------------------------------------
const x = new MockXClient(clock);
const store = new InMemoryStore();
const wallets = new MockWalletProvider();
const chain = new MockMarketChain(SWAP_FEE_BPS);
const engine = new RatioEngine(x, store, wallets, chain, {
  botHandle: BOT_HANDLE,
  freshnessWindowMs: FRESHNESS_WINDOW_MS,
  marketDurationMs: MARKET_DURATION_MS,
  seedPerSideUsd: SEED_PER_SIDE_USD,
  likesSampleIntervalMs: LIKES_SAMPLE_INTERVAL_MS,
  minStakeUsd: MIN_STAKE_USD,
  maxStakeUsd: MAX_STAKE_USD,
  hiddenReportThreshold: HIDDEN_REPORT_THRESHOLD,
  protocolWallet: "wallet:ratio-treasury",
  dopplerWallet: "wallet:doppler",
  feeShareBps: FEE_SHARE_BPS,
  marketUrl,
  walletBalanceUsd: async () => Number.POSITIVE_INFINITY, // mock world: everyone is solvent
  now: clock,
});

const user = (n: string) => ({ authorId: `u:${n}`, authorHandle: n });
const seedPair = (opts: {
  type: "quoted" | "replied_to";
  a: string;
  b: string;
  bAgeMs?: number;
  likesA?: number;
  likesB?: number;
}): { sideA: XTweet; sideB: XTweet } => {
  const sideA = x.seedTweet({
    ...user(opts.a),
    text: `${opts.a}'s take`,
    createdAtMs: clock() - 20 * HOUR,
    likeCount: opts.likesA ?? 0,
  });
  const sideB = x.seedTweet({
    ...user(opts.b),
    text: `${opts.b} answers ${opts.a}`,
    createdAtMs: clock() - (opts.bAgeMs ?? HOUR),
    likeCount: opts.likesB ?? 0,
    referencedTweet: { type: opts.type, tweetId: sideA.tweetId },
  });
  return { sideA, sideB };
};
const tagOn = (tweetId: string, by: string, text = "") =>
  x.queueMention({
    ...user(by),
    text: `@${BOT_HANDLE} ${text}`,
    target: { tweetId, type: "replied_to" },
  });
const betOn = (tweetId: string, by: string, text: string) =>
  x.queueMention({
    ...user(by),
    text: `@${BOT_HANDLE} ${text}`,
    target: { tweetId, type: "replied_to" },
  });

const scenario = (title: string) => console.log(`\n== ${title} ==`);

// ---------------------------------------------------------------------------
// 1. QT scout path: side A holds the line, money was on B
// ---------------------------------------------------------------------------
scenario("1. QT market — A holds, money surprised");
const m1 = seedPair({ type: "quoted", a: "alice", b: "bob", likesA: 50, likesB: 40 });
tagOn(m1.sideB.tweetId, "scout");
await engine.tick();
let rec = await store.getMarketByPair(m1.sideA.tweetId, m1.sideB.tweetId);
assert.ok(rec, "market created");
assert.equal(rec.pairType, "quote");
assert.equal(rec.likesAAtCreate, 50);
// all three participants got wallets provisioned at creation
for (const id of ["u:scout", "u:alice", "u:bob"])
  assert.ok(wallets.provisioned.includes(id), `wallet for ${id}`);

betOn(m1.sideB.tweetId, "carol", "$100 on B");
betOn(m1.sideB.tweetId, "dave", "$20 A");
await engine.tick();
assert.equal((await store.listBets(rec.id)).length, 2, "seeds excluded from participant trades");

advance(MARKET_DURATION_MS + 1);
x.setLikes(m1.sideA.tweetId, 300);
x.setLikes(m1.sideB.tweetId, 250);
await engine.resolveDueMarkets();
rec = await store.getMarketByTweet(m1.sideB.tweetId);
assert.equal(rec!.status, "settled");
assert.equal(rec!.winner, "a");
assert.equal(rec!.likesAFinal, 300);
assert.ok(rec!.finalImpliedA! < 0.5, "money was on B (snapshot pre-migration)");
// Token-weighted claim (§7): dave's actual multiple from his token count,
// not a dollar-share average.
const daveBet = (await store.listBets(rec!.id)).find((b) => b.xUserId === "u:dave")!;
const davePayout = chain.claimQuote(rec!.chainRefs, daveBet.tokensOut);
assert.ok(davePayout > daveBet.amountUsd, "winner clears their stake");
console.log(
  `   winner A at ${Math.round(rec!.finalImpliedA! * 100)}% implied, dave's $${daveBet.amountUsd} pays $${davePayout.toFixed(2)} (${(davePayout / daveBet.amountUsd).toFixed(2)}x)`,
);

// ---------------------------------------------------------------------------
// 2. Reply market — the actual ratio: B out-likes A
// ---------------------------------------------------------------------------
scenario("2. reply market — ratio confirmed");
const m2 = seedPair({ type: "replied_to", a: "eve", b: "mallory", likesA: 900, likesB: 800 });
tagOn(m2.sideB.tweetId, "scout");
await engine.tick();
betOn(m2.sideB.tweetId, "carol", "$50 B");
await engine.tick();
advance(MARKET_DURATION_MS + 1);
x.setLikes(m2.sideB.tweetId, 2_000); // absolute counts, no age normalisation
await engine.resolveDueMarkets();
rec = await store.getMarketByTweet(m2.sideB.tweetId);
assert.equal(rec!.winner, "b");
assert.equal(rec!.pairType, "reply");

// ---------------------------------------------------------------------------
// 3. Idempotency + duplicate pair
// ---------------------------------------------------------------------------
scenario("3. duplicate mention delivery + duplicate pair rejection");
const m3 = seedPair({ type: "quoted", a: "frank", b: "grace" });
const dup = tagOn(m3.sideB.tweetId, "scout");
await engine.tick();
x.queueMention(dup); // X polling re-shows the same mention
const postedBefore = x.posted.length;
await engine.tick();
assert.equal(x.posted.length, postedBefore, "duplicate delivery is a no-op");
tagOn(m3.sideB.tweetId, "otherscout"); // new mention, same pair
await engine.tick();
// duplicate converts: apologetic pointer WITH a direct link to the market
const dupReply = x.posted.at(-1)!;
assert.match(dupReply.text, /already live/);
assert.equal(dupReply.link, marketUrl(m3.sideB.tweetId), "links the existing market");

// ---------------------------------------------------------------------------
// 4. Late stake skipped after close
// ---------------------------------------------------------------------------
scenario("4. late stake");
const m4 = seedPair({ type: "quoted", a: "henry", b: "iris" });
tagOn(m4.sideB.tweetId, "scout");
await engine.tick();
const m4rec = (await store.getMarketByTweet(m4.sideB.tweetId))!;
advance(MARKET_DURATION_MS + 1);
betOn(m4.sideB.tweetId, "carol", "$50 A");
await engine.tick();
assert.equal((await store.listBets(m4rec.id)).length, 0, "late stake skipped");

// ---------------------------------------------------------------------------
// 5. Exact tie -> side A wins
// ---------------------------------------------------------------------------
scenario("5. exact tie goes to side A");
const m5 = seedPair({ type: "quoted", a: "jack", b: "kate" });
tagOn(m5.sideB.tweetId, "scout");
await engine.tick();
betOn(m5.sideB.tweetId, "carol", "$10 A");
betOn(m5.sideB.tweetId, "dave", "$10 B");
await engine.tick();
advance(MARKET_DURATION_MS + 1);
x.setLikes(m5.sideA.tweetId, 777);
x.setLikes(m5.sideB.tweetId, 777);
await engine.resolveDueMarkets();
rec = await store.getMarketByTweet(m5.sideB.tweetId);
assert.equal(rec!.status, "settled");
assert.equal(rec!.winner, "a", "tie: side A held the line");

// ---------------------------------------------------------------------------
// 6. One-sided market: the treasury seed makes it settleable (voids are gone)
// ---------------------------------------------------------------------------
scenario("6. seed makes a one-sided market settleable");
const m6 = seedPair({ type: "quoted", a: "liam", b: "mona", likesA: 100 });
tagOn(m6.sideB.tweetId, "scout");
await engine.tick();
betOn(m6.sideB.tweetId, "carol", "$40 B"); // all participant money on the loser
await engine.tick();
advance(MARKET_DURATION_MS + 1);
await engine.resolveDueMarkets();
rec = await store.getMarketByTweet(m6.sideB.tweetId);
assert.equal(rec!.status, "settled", "seed on the winner side prevents ZeroClaimableSupply");
assert.equal(rec!.winner, "a");
assert.ok(rec!.finalPotUsd! > 40, "pot includes the loser's money for the seed to win");

// ---------------------------------------------------------------------------
// 7. Deletion mid-window -> FORFEIT at settlement; sampler records likes
// ---------------------------------------------------------------------------
scenario("7. deletion forfeits; likes sampler records the series");
const m7 = seedPair({ type: "replied_to", a: "nina", b: "oscar", likesA: 50, likesB: 10 });
tagOn(m7.sideB.tweetId, "scout");
await engine.tick();
const m7id = (await store.getMarketByTweet(m7.sideB.tweetId))!.id;
// sampler records a point mid-window (the chart's likes series)
advance(MARKET_DURATION_MS * 0.3);
x.setLikes(m7.sideA.tweetId, 60);
await engine.sampleLikesDueMarkets();
const m7samples = await store.listLikeSamples(m7id);
assert.equal(m7samples.length, 1);
assert.equal(m7samples[0]!.likesA, 60, "sampler recorded fresh counts");
// side A deletes mid-window: nothing happens until the clock runs out —
// then the surviving side takes it by forfeit. No deleting your way out.
advance(MARKET_DURATION_MS * 0.3);
x.deleteTweet(m7.sideA.tweetId);
await engine.sampleLikesDueMarkets(); // unreadable: no sample, no action
assert.equal((await store.listLikeSamples(m7id)).length, 1);
rec = await store.getMarketByTweet(m7.sideB.tweetId);
assert.equal(rec!.status, "open", "sampler never settles anything");
advance(MARKET_DURATION_MS);
await engine.resolveDueMarkets();
rec = await store.getMarketByTweet(m7.sideB.tweetId);
assert.equal(rec!.status, "forfeited");
assert.equal(rec!.winner, "b", "the side still standing wins");
assert.equal(rec!.likesAFinal, 60, "last sampled count kept for the record");
assert.match(x.posted.at(-1)!.text, /no longer public.*takes it by forfeit/);

// ---------------------------------------------------------------------------
// 8. Eligibility rejections
// ---------------------------------------------------------------------------
scenario("8. rejections: standalone, self-pair, stale");
const lone = x.seedTweet({ ...user("pat"), text: "just a tweet" });
tagOn(lone.tweetId, "scout");
await engine.tick();
assert.match(x.posted.at(-1)!.text, /reply or quote tweet/);

const selfA = x.seedTweet({ ...user("quinn"), text: "my take" });
const selfB = x.seedTweet({
  ...user("quinn"),
  text: "replying to myself",
  referencedTweet: { type: "replied_to", tweetId: selfA.tweetId },
});
tagOn(selfB.tweetId, "scout");
await engine.tick();
assert.match(x.posted.at(-1)!.text, /same account/);

const stale = seedPair({ type: "quoted", a: "ruth", b: "sam", bAgeMs: 13 * HOUR });
tagOn(stale.sideB.tweetId, "scout");
await engine.tick();
assert.match(x.posted.at(-1)!.text, /under 12 hours/);

// ---------------------------------------------------------------------------
// 9. Author path: tag embedded in your own QT (rule 2)
// ---------------------------------------------------------------------------
scenario("9. author-path QT");
const orig = x.seedTweet({ ...user("tina"), text: "hot original", likeCount: 10 });
const authorQt = x.seedTweet({
  ...user("uma"),
  text: `terrible take @${BOT_HANDLE} ratio this`,
  referencedTweet: { type: "quoted", tweetId: orig.tweetId },
});
x.queueMention({
  mentionTweetId: authorQt.tweetId,
  ...user("uma"),
  text: authorQt.text,
  target: { tweetId: orig.tweetId, type: "quoted" },
});
await engine.tick();
rec = await store.getMarketByPair(orig.tweetId, authorQt.tweetId);
assert.ok(rec, "author-path market created");
assert.equal(rec.taggerXId, "u:uma");
assert.equal(rec.authorBXId, "u:uma", "tagger is also side B");
// clear the board: settle scenario 9's market (the seed carries the
// winning side) so scenario 10's failure injection targets one market
advance(MARKET_DURATION_MS + 1);
await engine.resolveDueMarkets();

// ---------------------------------------------------------------------------
// 10. Transient X API failure -> defer and retry, never void (R2)
// ---------------------------------------------------------------------------
scenario("10. transient API failure defers and retries");
const m10 = seedPair({ type: "quoted", a: "vera", b: "walt", likesA: 5, likesB: 9 });
tagOn(m10.sideB.tweetId, "scout");
await engine.tick();
betOn(m10.sideB.tweetId, "carol", "$25 B");
await engine.tick();

// likes sampler hits a flaky API: cadence must re-arm, not mark sampled
advance(MARKET_DURATION_MS * 0.6);
x.failNextGets = 2;
await engine.sampleLikesDueMarkets();
rec = await store.getMarketByTweet(m10.sideB.tweetId);
assert.equal(rec!.status, "open");
assert.equal(rec!.lastLikesSampleAtMs, undefined, "failed sample re-arms");
await engine.sampleLikesDueMarkets();
rec = await store.getMarketByTweet(m10.sideB.tweetId);
assert.ok(rec!.lastLikesSampleAtMs, "retry completed the sample");

// settlement hits a flaky API: market stays open, next tick settles it
advance(MARKET_DURATION_MS);
x.failNextGets = 2;
await engine.resolveDueMarkets();
rec = await store.getMarketByTweet(m10.sideB.tweetId);
assert.equal(rec!.status, "open", "transient failure deferred settlement");
await engine.resolveDueMarkets();
rec = await store.getMarketByTweet(m10.sideB.tweetId);
assert.equal(rec!.status, "settled");
assert.equal(rec!.winner, "b");

// ---------------------------------------------------------------------------
// 11. Hidden-reply badge: display flag only, never touches settlement
// ---------------------------------------------------------------------------
scenario("11. hidden badge — corroborated flag, settlement untouched");
const m11 = seedPair({ type: "replied_to", a: "xena", b: "yuri", likesA: 100, likesB: 90 });
tagOn(m11.sideB.tweetId, "scout");
await engine.tick();
betOn(m11.sideB.tweetId, "carol", "$30 B");
await engine.tick();
const m11id = (await store.getMarketByTweet(m11.sideB.tweetId))!.id;

// one client reporting many times is one report
await engine.reportHidden(m11id, "ext:client-1");
await engine.reportHidden(m11id, "ext:client-1");
await engine.reportHidden(m11id, "ext:client-1");
rec = await store.getMarketByTweet(m11.sideB.tweetId);
assert.equal(rec!.hiddenReportCount, 1, "duplicate reporter deduped");
assert.equal(rec!.hiddenReportedAtMs, undefined, "one browser is not a fact");

// independent corroboration crosses the threshold: badge + one bot post
await engine.reportHidden(m11id, "ext:client-2");
const postsBefore = x.posted.length;
await engine.reportHidden(m11id, "ext:client-3");
rec = await store.getMarketByTweet(m11.sideB.tweetId);
assert.ok(rec!.hiddenReportedAtMs, "badge live at threshold");
assert.equal(x.posted.length, postsBefore + 1);
assert.match(x.posted.at(-1)!.text, /no longer showing in the thread/);
assert.doesNotMatch(
  x.posted.at(-1)!.text,
  /@xena|hid/,
  "observation, not accusation",
);
await engine.reportHidden(m11id, "ext:client-4"); // past threshold: no re-post
assert.equal(x.posted.length, postsBefore + 1, "notice posts exactly once");

// QT markets cannot be hidden: reports on them are dropped
const m11q = seedPair({ type: "quoted", a: "zach", b: "abby" });
tagOn(m11q.sideB.tweetId, "scout");
await engine.tick();
const qtId = (await store.getMarketByTweet(m11q.sideB.tweetId))!.id;
for (const r of ["ext:client-1", "ext:client-2", "ext:client-3"])
  await engine.reportHidden(qtId, r);
rec = await store.getMarketByTweet(m11q.sideB.tweetId);
assert.equal(rec!.hiddenReportCount, 0, "QT market ignores hide reports");

// settlement is pure likes: the hidden reply out-likes the OP and WINS —
// the badge routed attention to it, it never routed the payout
advance(MARKET_DURATION_MS + 1);
x.setLikes(m11.sideB.tweetId, 150);
await engine.resolveDueMarkets();
rec = await store.getMarketByTweet(m11.sideB.tweetId);
assert.equal(rec!.status, "settled");
assert.equal(rec!.winner, "b", "hidden reply won on likes alone");
assert.ok(rec!.hiddenReportedAtMs, "badge survives settlement for the recap");

// ---------------------------------------------------------------------------
// 12. No markets on your own post (tagger == side A author)
// ---------------------------------------------------------------------------
scenario("12. own-post rejection");
const m12 = seedPair({ type: "replied_to", a: "aaron", b: "beth" });
tagOn(m12.sideB.tweetId, "aaron"); // side A's author tags the reply to them
await engine.tick();
assert.match(x.posted.at(-1)!.text, /no markets on your own post/);
assert.equal(
  await store.getMarketByTweet(m12.sideB.tweetId),
  undefined,
  "own-post tag opens nothing",
);
tagOn(m12.sideB.tweetId, "beth"); // side B's author self-tagging IS allowed
await engine.tick();
rec = await store.getMarketByTweet(m12.sideB.tweetId);
assert.ok(rec, "side B author can call their own reply");
assert.equal(rec!.taggerXId, "u:beth", "stacks tagger + side B slices");

// ---------------------------------------------------------------------------
// 13. Post view + trending: count displayed, volume ranks
// ---------------------------------------------------------------------------
scenario("13. post aggregation (count is a count) + volume trending");
// post P: three markets, small money; post Q: one market, big money
const postP = x.seedTweet({ authorId: "u:pat", authorHandle: "pat", text: "hot take", likeCount: 40, createdAtMs: clock() });
const postQ = x.seedTweet({ authorId: "u:quinn", authorHandle: "quinn", text: "hotter take", likeCount: 40, createdAtMs: clock() });
const repliesP = ["r1", "r2", "r3"].map((h) =>
  x.seedTweet({
    authorId: `u:${h}`, authorHandle: h, text: "nah", likeCount: 1,
    createdAtMs: clock(),
    referencedTweet: { type: "replied_to", tweetId: postP.tweetId },
  }),
);
const replyQ = x.seedTweet({
  authorId: "u:rq", authorHandle: "rq", text: "nah", likeCount: 1,
  createdAtMs: clock(),
  referencedTweet: { type: "replied_to", tweetId: postQ.tweetId },
});
for (const r of repliesP) tagOn(r.tweetId, "scout");
tagOn(replyQ.tweetId, "scout");
await engine.tick();
for (const r of repliesP) betOn(r.tweetId, "carol", "$10 B");
betOn(replyQ.tweetId, "dave", "$200 B");
await engine.tick();

const postView = await store.listMarketsByPost(postP.tweetId);
assert.equal(postView.length, 3, "post view: all markets sharing side A");
assert.ok(
  postView.every((m) => m.status === "open" && m.tweetAId === postP.tweetId),
  "each market self-contained, keyed to the post",
);
const trending = await store.trendingPosts(10);
const SEEDS = 2 * SEED_PER_SIDE_USD; // per-market treasury seed, part of staked
assert.equal(trending[0]!.tweetAId, postQ.tweetId, "volume outranks count");
assert.equal(trending[0]!.marketCount, 1);
assert.equal(trending[0]!.stakedVolumeUsd, 200 + SEEDS);
const pRow = trending.find((t) => t.tweetAId === postP.tweetId)!;
assert.equal(pRow.marketCount, 3, "count surfaces for display");
assert.equal(pRow.stakedVolumeUsd, 30 + 3 * SEEDS, "three cheap markets rank below one big one");

// ---------------------------------------------------------------------------
// 14. Handle-based stakes (§4: people, not letters) with A/B fallback
// ---------------------------------------------------------------------------
scenario("14. handle stakes — $25 @handle, letters still tolerated");
const m14 = seedPair({ type: "quoted", a: "cora", b: "dex", likesA: 10, likesB: 30 });
tagOn(m14.sideB.tweetId, "scout");
await engine.tick();
const m14id = (await store.getMarketByTweet(m14.sideB.tweetId))!.id;

betOn(m14.sideB.tweetId, "carol", "$25 @cora"); // handle grammar, original
betOn(m14.sideB.tweetId, "dave", "$10 on @dex"); // handle grammar with "on"
betOn(m14.sideB.tweetId, "erin", "@dex 15"); // reversed handle grammar
betOn(m14.sideB.tweetId, "fred", "$20 B"); // letter fallback still works
betOn(m14.sideB.tweetId, "gary", "$50 @stranger"); // not a side: skip, no reply
const posted14 = x.posted.length;
await engine.tick();
let bets14 = await store.listBets(m14id);
assert.equal(bets14.length, 4, "four stakes landed, stranger skipped");
assert.deepEqual(
  bets14.map((b) => b.side),
  [0, 1, 1, 1],
  "handles resolved to the right sides",
);
assert.equal(x.posted.length, posted14 + 4, "no reply spend on the skip");
assert.match(x.posted.at(-1)!.text, /put \$20 on @dex/, "confirms name people");
assert.doesNotMatch(x.posted.at(-1)!.text, /on [AB]\b/, "no side letters in copy");

// ---------------------------------------------------------------------------
// 15. Fee leaderboard — combined board, per-role breakdown, rolling window
// ---------------------------------------------------------------------------
scenario("15. fee leaderboard (rolling window)");
const allTimeBefore = await store.feeLeaderboard({ sinceMs: 0 });
assert.ok(allTimeBefore.length > 0, "history exists from earlier scenarios");

// jump far ahead: the rolling 24h window must only see what follows
advance(30 * 24 * HOUR);
const windowStart = clock();
const m15 = seedPair({ type: "replied_to", a: "zara", b: "yanni", likesA: 5, likesB: 6 });
tagOn(m15.sideB.tweetId, "scout2");
await engine.tick();
betOn(m15.sideB.tweetId, "carol", "$100 @zara");
betOn(m15.sideB.tweetId, "dave", "$60 @yanni");
await engine.tick();

const board = await store.feeLeaderboard({ sinceMs: windowStart });
// volume incl. seeds; fees split by FEE_SHARE_BPS — computed, not hardcoded
const m15Volume = 160 + 2 * SEED_PER_SIDE_USD;
const m15Fees = (m15Volume * SWAP_FEE_BPS) / 10_000;
const expectSideA = (m15Fees * FEE_SHARE_BPS.sideA) / 10_000;
const expectTagger = (m15Fees * FEE_SHARE_BPS.tagger) / 10_000;
const by = (h: string) => board.find((r) => r.handle === h)!;
assert.equal(board.length, 3, "window isolates the fresh market's three earners");
assert.ok(Math.abs(by("zara").totalFeeUsd - expectSideA) < 1e-9);
assert.ok(Math.abs(by("zara").byRole.sideA - expectSideA) < 1e-9, "role breakdown: all from being the original");
assert.ok(Math.abs(by("yanni").byRole.sideB - expectSideA) < 1e-9);
assert.ok(Math.abs(by("scout2").byRole.tagger - expectTagger) < 1e-9, "tagger slice");
assert.ok(by("zara").totalFeeUsd >= by("scout2").totalFeeUsd, "ranked by total");

const allTime = await store.feeLeaderboard({ sinceMs: 0 });
assert.ok(allTime.length > board.length, "all-time keeps the older earners");

// ---------------------------------------------------------------------------
// 16. Site-architecture store queries (schema hardening before R5)
// ---------------------------------------------------------------------------
scenario("16. profile / feed / position queries");
// zara touched exactly one market, as side A
const zaraMarkets = await store.listMarketsByParticipant("u:zara");
assert.equal(zaraMarkets.length, 1);
assert.equal(zaraMarkets[0]!.authorAXId, "u:zara");
// scout has tagged many markets across the sim
const scoutMarkets = await store.listMarketsByParticipant("u:scout");
assert.ok(scoutMarkets.length >= 5, "tagger role counts as participation");

// feed ranking: m15 ($160) is the only open market with volume in-window
const feed = await store.listMarketsByVolume({ sinceMs: windowStart, limit: 5 });
assert.equal(feed[0]!.id, m15.sideB.tweetId, "feed ranks by staked volume");
assert.ok(
  feed.every((m) => m.status === "open"),
  "settled markets drop off the default feed",
);

// positions: carol holds side A of m15, net of nothing sold yet
const carolPositions = await store.openPositionsByUser("u:carol");
const carolM15 = carolPositions.find((p) => p.marketId === m15.sideB.tweetId)!;
assert.equal(carolM15.side, 0);
assert.ok(carolM15.tokens > 0);
assert.ok(Math.abs(carolM15.netStakedUsd - 100) < 1e-9);
// a sell trade nets the position down (direction fidelity — unbackfillable)
await store.saveBet({
  marketId: m15.sideB.tweetId,
  xUserId: "u:carol",
  handle: "carol",
  side: 0,
  direction: "sell",
  amountUsd: 30,
  tokensOut: carolM15.tokens / 2,
  placedAtMs: clock(),
});
const after = (await store.openPositionsByUser("u:carol")).find(
  (p) => p.marketId === m15.sideB.tweetId,
)!;
assert.ok(Math.abs(after.tokens - carolM15.tokens / 2) < 1e-9, "sell halves the tokens");
assert.ok(Math.abs(after.netStakedUsd - 70) < 1e-9, "sell proceeds net the stake");

// Feed ranks NET staked, not gross buys: a market whose money ran for the
// exit ($200 in, $180 out) sits below a smaller intact one ($50 in) —
// gross would surface the dead market. Gross stays the number for the
// extension's historical post volume (trendingPosts).
const mDead = seedPair({ type: "quoted", a: "gone", b: "ghost" });
const mAlive = seedPair({ type: "quoted", a: "here", b: "now" });
tagOn(mDead.sideB.tweetId, "scout");
tagOn(mAlive.sideB.tweetId, "scout");
await engine.tick();
betOn(mDead.sideB.tweetId, "dave", "$200 @ghost");
betOn(mAlive.sideB.tweetId, "erin", "$50 @now");
await engine.tick();
const deadId = (await store.getMarketByTweet(mDead.sideB.tweetId))!.id;
await store.saveBet({
  marketId: deadId, xUserId: "u:dave", handle: "dave", side: 1,
  direction: "sell", amountUsd: 180, tokensOut: 1, placedAtMs: clock(),
});
const feed2 = await store.listMarketsByVolume({ sinceMs: windowStart, limit: 10 });
const deadRank = feed2.findIndex((m) => m.id === deadId);
const aliveRank = feed2.findIndex((m) => m.id === (mAlive.sideB.tweetId));
assert.ok(aliveRank < deadRank, "net ranking: intact $50 beats drained $200");

// ---------------------------------------------------------------------------
// 17. Exit-fee curve + ramp-start instrumentation (DORMANT: sells are
// protocol-impossible; the curve is kept as a record, wired to nothing)
// ---------------------------------------------------------------------------
scenario("17. exit fee: floor, smooth ramp, ceiling, ramp-start metric");
const HOUR_MS = 60 * 60 * 1000;
// floor holds through the first 12h
assert.equal(exitFeeBps(0), SWAP_FEE_BPS);
assert.equal(exitFeeBps(6 * HOUR_MS), SWAP_FEE_BPS);
assert.equal(exitFeeBps(EXIT_FEE_RAMP_START_MS), SWAP_FEE_BPS);
// smooth start: minutes past the ramp the fee has barely moved (no cliff)
assert.ok(exitFeeBps(EXIT_FEE_RAMP_START_MS + 30 * 60_000) < SWAP_FEE_BPS + 60,
  "no step at the ramp start");
// monotone to the ceiling, ceiling is TOTAL (floor included)
let prevFee = 0;
for (let h = 0; h <= 24; h++) {
  const f = exitFeeBps(h * HOUR_MS);
  assert.ok(f >= prevFee, "fee never decreases");
  prevFee = f;
}
assert.equal(exitFeeBps(24 * HOUR_MS), EXIT_FEE_MAX_BPS);

// ramp-start metric: sells 10m before and 10m after m15's hour-12 mark
const m15rec = (await store.getMarketByTweet(m15.sideB.tweetId))!;
const rampAt = m15rec.createdAtMs + EXIT_FEE_RAMP_START_MS;
await store.saveBet({
  marketId: m15rec.id, xUserId: "u:dave", handle: "dave", side: 1,
  direction: "sell", amountUsd: 20, tokensOut: 1, placedAtMs: rampAt - 10 * 60_000,
});
await store.saveBet({
  marketId: m15rec.id, xUserId: "u:erin", handle: "erin", side: 1,
  direction: "sell", amountUsd: 15, tokensOut: 1, placedAtMs: rampAt + 10 * 60_000,
});
const nearRamp = await store.sellsNearRampStart({
  rampStartMs: EXIT_FEE_RAMP_START_MS,
  windowMs: 30 * 60_000,
});
assert.ok(nearRamp.justBefore >= 1 && nearRamp.justAfter >= 1, "ramp-start metric counts both sides");


// ---------------------------------------------------------------------------
// 18. Trader leaderboard: winners profit, losers bleed, seeds invisible
// ---------------------------------------------------------------------------
scenario("18. trader board: profit ranking, seeds excluded");
const traders = await store.traderLeaderboard({ sinceMs: 0 });
assert.ok(traders.length > 0, "board has rows once markets settle");
assert.ok(
  traders.every((t) => t.xUserId !== "ratio:treasury"),
  "the treasury is not a trader",
);
// ranked by profit, descending
for (let i = 1; i < traders.length; i++) {
  assert.ok(traders[i - 1]!.profitUsd >= traders[i]!.profitUsd, "sorted by profit");
}
// every decided bet lands in exactly one of wins/losses
for (const t of traders) {
  assert.ok(t.wins + t.losses > 0, "rows only for people with decided bets");
  assert.ok(t.winRate >= 0 && t.winRate <= 1, "win rate is a rate");
}
// zero-sum sanity: total profit across traders = -(fees + seed dilution),
// never positive (the house cannot pay out more than went in)
const totalProfit = traders.reduce((sum, t) => sum + t.profitUsd, 0);
assert.ok(totalProfit <= 0.01, `traders in aggregate cannot beat the fee: ${totalProfit}`);

console.log("\n✅ all R1+R2 scenarios passed");
