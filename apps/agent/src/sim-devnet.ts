/**
 * Devnet sim: the REAL RatioEngine driving fake X against the REAL chain —
 * DopplerMarketChain + LocalWalletProvider (Privy stand-in), real programs,
 * real fee split, real settlement. The mock sim (sim.ts) proves the flow
 * logic; this proves the engine's chain seam carries it unchanged.
 *
 * One market, deliberately: every launch costs devnet SOL and minutes.
 * Run: npm run sim:devnet -w @ratio/agent
 */
import assert from "node:assert/strict";

import {
  BOT_HANDLE,
  FEE_SHARE_BPS,
  FRESHNESS_WINDOW_MS,
  LIKES_SAMPLE_INTERVAL_MS,
  SEED_PER_SIDE_USD,
  HIDDEN_REPORT_THRESHOLD,
  MARKET_DURATION_MS,
  MAX_STAKE_USD,
  MIN_STAKE_USD,
  SWAP_FEE_BPS,
  marketUrl,
} from "@ratio/config";
import { RatioMarketClient } from "@ratio/doppler/pair-market";
import { createClients } from "@ratio/doppler/tx";
import { generateKeyPairSigner } from "@solana/kit";

import { DopplerMarketChain } from "./chainDevnet.js";
import { RatioEngine } from "./engine.js";
import { InMemoryStore } from "./store.js";
import { LocalWalletProvider } from "./walletsDevnet.js";
import { MockXClient, seedMockIds } from "./x.js";
import { ensureFunded, loadOrCreateKeypairBytes, sol } from "./simDevnetKeys.js";

// Fake clock (the chain does not care about our market clock).
let simNow = Date.now();
const clock = () => simNow;
// Tweet ids become oracle nonces: wall-clock seed so PDAs never collide
// with a previous run's on-chain accounts.
seedMockIds(Date.now());

const LAMPORTS_PER_USD = 500_000n; // $1 = 0.0005 SOL on the WSOL devnet quote

async function main() {
  const clients = createClients();
  const operator = await loadOrCreateKeypairBytes(
    new URL("../../../packages/doppler/scripts/.keys/devnet-payer.json", import.meta.url)
      .pathname,
  );
  console.log("operator:", operator.address);
  console.log("balance:", sol(await ensureFunded(clients, operator.address, 0.6)));

  const [dopplerWallet, protocolWallet] = await Promise.all([
    generateKeyPairSigner(),
    generateKeyPairSigner(),
  ]);
  const marketClient = await RatioMarketClient.create({ clients, operator });
  // 0.04 SOL/wallet: covers the $25 (0.0125 SOL) max stake in this sim + rent/fees.
  const wallets = new LocalWalletProvider(clients, operator, 40_000_000n);
  const chain = new DopplerMarketChain(clients, marketClient, {
    swapFeeBps: SWAP_FEE_BPS,
    lamportsPerUsd: LAMPORTS_PER_USD,
    signerFor: (addr) =>
      addr === operator.address ? operator : wallets.signerFor(addr),
  });
  const x = new MockXClient(clock);
  const store = new InMemoryStore();
  const engine = new RatioEngine(x, store, wallets, chain, {
    botHandle: BOT_HANDLE,
    freshnessWindowMs: FRESHNESS_WINDOW_MS,
    marketDurationMs: MARKET_DURATION_MS,
    seedPerSideUsd: SEED_PER_SIDE_USD,
    likesSampleIntervalMs: LIKES_SAMPLE_INTERVAL_MS,
    minStakeUsd: MIN_STAKE_USD,
    maxStakeUsd: MAX_STAKE_USD,
    hiddenReportThreshold: HIDDEN_REPORT_THRESHOLD,
    // operator doubles as treasury on devnet: seeds sign + fund from it
    protocolWallet: operator.address,
    dopplerWallet: dopplerWallet.address,
    feeShareBps: FEE_SHARE_BPS,
    marketUrl,
    now: clock,
  });

  // -- the ratio: a reply market, tagged by a scout, staked both ways -------
  console.log("\n[1/3] mention -> eligibility -> market on devnet…");
  const sideA = x.seedTweet({
    authorId: "u:opa", authorHandle: "opa", text: "original take",
    createdAtMs: clock() - 2 * 60 * 60 * 1000, likeCount: 30,
  });
  const sideB = x.seedTweet({
    authorId: "u:rep", authorHandle: "rep", text: "the answer",
    createdAtMs: clock() - 60 * 60 * 1000, likeCount: 10,
    referencedTweet: { type: "replied_to", tweetId: sideA.tweetId },
  });
  x.queueMention({
    authorId: "u:scout", authorHandle: "scout",
    text: `@${BOT_HANDLE}`, target: { tweetId: sideB.tweetId, type: "replied_to" },
  });
  await engine.tick();
  let rec = await store.getMarketByTweet(sideB.tweetId);
  assert.ok(rec, "market created on-chain");
  assert.equal(rec.status, "open");
  console.log("  market open, five beneficiaries wired at launch");

  console.log("\n[2/3] reply-stakes (real swaps, sponsored wallets)…");
  x.queueMention({
    authorId: "u:carol", authorHandle: "carol",
    text: `@${BOT_HANDLE} $25 A`, target: { tweetId: sideB.tweetId, type: "replied_to" },
  });
  x.queueMention({
    authorId: "u:dave", authorHandle: "dave",
    text: `@${BOT_HANDLE} $10 B`, target: { tweetId: sideB.tweetId, type: "replied_to" },
  });
  await engine.tick();
  assert.equal((await store.listBets(rec.id)).length, 2, "both stakes landed");
  const odds = await chain.getOdds(rec.chainRefs);
  console.log(
    `  pot shares: A ${(odds.impliedA * 100).toFixed(1)}% / B ${((1 - odds.impliedA) * 100).toFixed(1)}%`,
  );
  assert.ok(Math.abs(odds.impliedA - 25 / 35) < 0.02, "on-chain pot ratio matches stakes");

  console.log("\n[3/3] settlement: B out-likes A -> finalize -> migrate…");
  simNow += MARKET_DURATION_MS + 1;
  x.setLikes(sideB.tweetId, 100); // the ratio lands
  await engine.resolveDueMarkets();
  rec = await store.getMarketByTweet(sideB.tweetId);
  assert.equal(rec!.status, "settled");
  assert.equal(rec!.winner, "b");
  assert.ok(rec!.finalImpliedA! > 0.5, "money was on A; likes surprised the money");
  // The pre-migration snapshot reads quote vaults, which hold GROSS stakes;
  // the 1.25% fee is realized into the pot at migration (e2e proves the
  // migrated pot = staked − fee). Display code must treat the snapshot as
  // gross volume, not the claimable pot.
  assert.ok(
    Math.abs(rec!.finalPotUsd! - 35) < 0.05,
    `snapshot = $35 gross staked (got ${rec!.finalPotUsd})`,
  );
  const netPot = 35 * (1 - SWAP_FEE_BPS / 10_000);
  console.log(
    `  settled. snapshot $${rec!.finalPotUsd!.toFixed(2)} gross, claimable pot ≈ $${netPot.toFixed(2)}`,
  );

  console.log("\nengine + real devnet chain: full loop green ✅");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
