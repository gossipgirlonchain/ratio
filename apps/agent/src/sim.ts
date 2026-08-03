/**
 * Scripted end-to-end sim: fake X, fake clock, mock chain with parimutuel
 * semantics. Proves R1 before any real surface exists. Run: npm run sim
 */
import assert from "node:assert/strict";

import {
  BOT_HANDLE,
  FEE_SHARE_BPS,
  FRESHNESS_WINDOW_MS,
  HEALTH_CHECK_AT_FRACTION,
  HIDDEN_REPORT_THRESHOLD,
  MARKET_DURATION_MS,
  MAX_STAKE_USD,
  MIN_STAKE_USD,
  SWAP_FEE_BPS,
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
  healthCheckAtFraction: HEALTH_CHECK_AT_FRACTION,
  minStakeUsd: MIN_STAKE_USD,
  maxStakeUsd: MAX_STAKE_USD,
  hiddenReportThreshold: HIDDEN_REPORT_THRESHOLD,
  protocolWallet: "wallet:ratio-treasury",
  dopplerWallet: "wallet:doppler",
  feeShareBps: FEE_SHARE_BPS,
  marketUrl,
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
assert.equal((await store.listBets(rec.id)).length, 2);

advance(MARKET_DURATION_MS + 1);
x.setLikes(m1.sideA.tweetId, 300);
x.setLikes(m1.sideB.tweetId, 250);
await engine.resolveDueMarkets();
rec = await store.getMarketByTweet(m1.sideB.tweetId);
assert.equal(rec!.status, "settled");
assert.equal(rec!.winner, "a");
assert.equal(rec!.likesAFinal, 300);
assert.ok(rec!.finalImpliedA! < 0.5, "money was on B (snapshot pre-migration)");
console.log(
  `   winner A at ${Math.round(rec!.finalImpliedA! * 100)}% implied, payout ${chain.payoutMultiple(rec!.chainRefs).toFixed(2)}x`,
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
// 6. One-sided market: winner has no money -> void, never settle
// ---------------------------------------------------------------------------
scenario("6. ZeroClaimableSupply guard");
const m6 = seedPair({ type: "quoted", a: "liam", b: "mona", likesA: 100 });
tagOn(m6.sideB.tweetId, "scout");
await engine.tick();
betOn(m6.sideB.tweetId, "carol", "$40 B"); // only money is on the loser
await engine.tick();
advance(MARKET_DURATION_MS + 1);
await engine.resolveDueMarkets();
rec = await store.getMarketByTweet(m6.sideB.tweetId);
assert.equal(rec!.status, "voided");
assert.match(rec!.voidReason!, /no money/);

// ---------------------------------------------------------------------------
// 7. Mid-window deletion -> health check voids before settlement
// ---------------------------------------------------------------------------
scenario("7. mid-window health check");
const m7 = seedPair({ type: "replied_to", a: "nina", b: "oscar" });
tagOn(m7.sideB.tweetId, "scout");
await engine.tick();
advance(MARKET_DURATION_MS * 0.6);
x.deleteTweet(m7.sideA.tweetId);
await engine.healthCheckDueMarkets();
rec = await store.getMarketByTweet(m7.sideB.tweetId);
assert.equal(rec!.status, "voided");
assert.match(rec!.voidReason!, /mid market/);

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
// clear the board: run scenario 9's market to its (moneyless) void so
// scenario 10's failure injection targets exactly one open market
advance(MARKET_DURATION_MS + 1);
await engine.resolveDueMarkets();

// ---------------------------------------------------------------------------
// 10. Transient X API failure -> defer and retry, never void (R2)
// ---------------------------------------------------------------------------
scenario("10. transient API failure retries, does not void");
const m10 = seedPair({ type: "quoted", a: "vera", b: "walt", likesA: 5, likesB: 9 });
tagOn(m10.sideB.tweetId, "scout");
await engine.tick();
betOn(m10.sideB.tweetId, "carol", "$25 B");
await engine.tick();

// health check hits a flaky API: check must re-arm, not mark done
advance(MARKET_DURATION_MS * 0.6);
x.failNextGets = 2;
await engine.healthCheckDueMarkets();
rec = await store.getMarketByTweet(m10.sideB.tweetId);
assert.equal(rec!.status, "open");
assert.equal(rec!.healthCheckedAtMs, undefined, "failed check re-arms");
await engine.healthCheckDueMarkets();
rec = await store.getMarketByTweet(m10.sideB.tweetId);
assert.ok(rec!.healthCheckedAtMs, "retry completed the check");

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
assert.equal(trending[0]!.tweetAId, postQ.tweetId, "volume outranks count");
assert.equal(trending[0]!.marketCount, 1);
assert.equal(trending[0]!.stakedVolumeUsd, 200);
const pRow = trending.find((t) => t.tweetAId === postP.tweetId)!;
assert.equal(pRow.marketCount, 3, "count surfaces for display");
assert.equal(pRow.stakedVolumeUsd, 30, "three cheap markets rank below one big one");

// ---------------------------------------------------------------------------
scenario("instrumentation: void rate by side-B age bucket (3h)");
for (const [bucket, row] of await store.voidRateByAgeBucket(3 * HOUR))
  console.log(
    `   ${bucket * 3}-${bucket * 3 + 3}h: ${row.voided}/${row.total} voided`,
  );

console.log("\n✅ all R1+R2 scenarios passed");
