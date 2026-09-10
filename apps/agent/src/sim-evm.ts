/**
 * The real RatioEngine against the real Base Sepolia chain, with a fake X.
 *
 * The EVM counterpart of sim-devnet.ts, and the thing that has never actually
 * been exercised: LifecycleBaseSepolia.s.sol proved the CHAIN lifecycle works,
 * but it is a standalone forge script that calls Doppler directly. It does not
 * touch RatioEngine, EvmMarketChain, the WalletProvider seam, or the parser.
 * This does — the same engine that will read real mentions, driven by scripted
 * ones instead.
 *
 * Nothing is posted to X. MockXClient logs what the bot would have said.
 *
 * One market, deliberately: every launch costs real testnet ETH and a couple
 * of minutes of confirmations.
 *
 *   BASE_SEPOLIA_PRIVATE_KEY=0x... npx tsx apps/agent/src/sim-evm.ts
 */
import assert from "node:assert/strict";

import {
  BOT_HANDLE,
  FEE_SHARE_BPS,
  FRESHNESS_WINDOW_MS,
  HIDDEN_REPORT_THRESHOLD,
  LIKES_SAMPLE_INTERVAL_MS,
  MAX_STAKE_USD,
  MIN_STAKE_USD,
  SEED_PER_SIDE_USD,
  marketUrl,
} from "@ratio/config";
import {
  BASE_SEPOLIA,
  BASE_SEPOLIA_RPC,
  EvmMarketChain,
  coinbaseEthUsd,
} from "@ratio/chain/evm";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";

import { RatioEngine } from "./engine.js";
import { InMemoryStore } from "./store.js";
import { SupabaseStore } from "./storeSupabase.js";
import { LocalEvmWalletProvider } from "./walletsEvmLocal.js";
import { MockXClient, seedMockIds, type XTweet } from "./x.js";

/**
 * A 90-second market. A real chain cannot be warped and RatioOracle refuses to
 * resolve before settlesAt, so 24h would mean waiting a day to see settlement.
 *
 * Not zero, either: at zero the market is already closed the instant it opens
 * and the engine correctly refuses every stake as late. Short enough to watch,
 * long enough to bet into.
 */
const MARKET_DURATION_MS = Number(process.env.RATIO_SIM_MARKET_MS ?? 90_000);

/**
 * Stop after the stakes and leave the market OPEN.
 *
 * A 90-second market proves the loop but cannot be looked at: by the time the
 * app renders it, it has settled and the hook refuses further entries, so
 * every quote comes back refused and the trade panel has nothing to show. With
 * RATIO_SIM_OPEN_ONLY=1 and a longer RATIO_SIM_MARKET_MS, a run leaves behind
 * a live market that the product can actually be used against.
 */
const OPEN_ONLY = process.env.RATIO_SIM_OPEN_ONLY === "1";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`RATIO_SIM_STORE=supabase needs ${name}`);
  return v;
}

async function main() {
  const pk = process.env.BASE_SEPOLIA_PRIVATE_KEY;
  if (!pk) {
    console.error("need BASE_SEPOLIA_PRIVATE_KEY (see contracts/.env)");
    process.exit(1);
  }
  const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL ?? BASE_SEPOLIA_RPC;
  const operator = privateKeyToAccount(pk as Hex);

  // Sim wallets derive from the operator key, so re-runs reuse them instead
  // of stranding funding in fresh throwaways.
  const wallets = new LocalEvmWalletProvider(rpcUrl, operator, pk as Hex);
  const balance = await wallets.balance(operator.address);
  console.log(`operator ${operator.address}, ${Number(balance) / 1e18} ETH`);
  if (balance < 3_000_000_000_000_000n) {
    console.error("operator under 0.003 ETH — fund it before running this");
    process.exit(1);
  }

  /**
   * The store is a choice, and it is the difference between a chain proof and
   * a product demo.
   *
   * InMemoryStore proves the engine drives the chain. But the app joins money
   * to tweets through the store, so a market that exists only in memory is
   * invisible in the product however real it is on Base Sepolia — the index
   * has it, our store does not, and nothing renders. RATIO_SIM_STORE=supabase
   * writes the market where the app can see it, so one run produces a market
   * that is real on both sides of the join.
   *
   * Mock tweets, real chain, real store row. Nothing is posted to X either
   * way.
   */
  const useSupabase = process.env.RATIO_SIM_STORE === "supabase";
  const store = useSupabase
    ? new SupabaseStore(
        requireEnv("SUPABASE_URL"),
        requireEnv("SUPABASE_SERVICE_KEY"),
      )
    : new InMemoryStore();
  console.log(useSupabase ? "store: supabase (visible in the app)" : "store: in-memory");
  const ethUsd = coinbaseEthUsd();
  console.log(`ETH/USD ${await ethUsd()}`);

  const chain = new EvmMarketChain({
    rpcUrl,
    addresses: BASE_SEPOLIA,
    operator,
    signerFor: (addr) =>
      addr.toLowerCase() === operator.address.toLowerCase()
        ? operator
        : wallets.accountFor(addr),
    ethUsd,
    marketDurationMs: MARKET_DURATION_MS,
    // No subgraph in the sim: odds come from the trades we just placed.
    raisedWeiFor: async (marketId) => {
      const bets = await store.listBets(marketId);
      const rate = await ethUsd();
      const wei: [bigint, bigint] = [0n, 0n];
      for (const b of bets) {
        wei[b.side] += BigInt(Math.round((b.amountUsd / rate) * 1e18));
      }
      return wei;
    },
  });

  // Fake X, real chain. Wall-clock ids: they become market ids, and a reused
  // one collides with a previous run's oracle.
  seedMockIds(Date.now() % 1_000_000_000);
  const clock = () => Date.now();
  const x = new MockXClient(clock);

  const engine = new RatioEngine(x, store, wallets, chain, {
    botHandle: BOT_HANDLE,
    freshnessWindowMs: FRESHNESS_WINDOW_MS,
    marketDurationMs: MARKET_DURATION_MS,
    seedPerSideUsd: SEED_PER_SIDE_USD,
    likesSampleIntervalMs: LIKES_SAMPLE_INTERVAL_MS,
    minStakeUsd: MIN_STAKE_USD,
    maxStakeUsd: MAX_STAKE_USD,
    hiddenReportThreshold: HIDDEN_REPORT_THRESHOLD,
    protocolWallet: (await wallets.getWallet("ratio:treasury")).address,
    dopplerWallet: await chain.airlockOwner(),
    feeShareBps: FEE_SHARE_BPS,
    marketUrl,
    now: clock,
  });

  const user = (n: string) => ({ authorId: `u:${n}`, authorHandle: n });
  const HOUR = 3_600_000;

  // ---- 1. a scout tags a reply -------------------------------------------
  console.log("\n[1/4] mention -> eligibility -> market on Base Sepolia…");
  const sideA = x.seedTweet({
    ...user("opa"),
    text: "original take",
    createdAtMs: clock() - 2 * HOUR,
    likeCount: 30,
  });
  const sideB = x.seedTweet({
    ...user("rep"),
    text: "the answer",
    createdAtMs: clock() - HOUR,
    likeCount: 10,
    referencedTweet: { type: "replied_to", tweetId: sideA.tweetId },
  });
  x.queueMention({ ...user("scout"), text: `@${BOT_HANDLE}`, target: { tweetId: sideB.tweetId, type: "replied_to" } });

  await engine.tick();
  const rec = await store.getMarketByPair(sideA.tweetId, sideB.tweetId);
  assert.ok(rec, "market created");
  console.log(`  market ${rec.id}, oracle ${await chain.oracleFor(rec.id)}`);

  // ---- 2. two stakes, one in dollars and one in ETH -----------------------
  console.log("\n[2/4] reply-stakes in both units…");
  x.queueMention({ ...user("dave"), text: `@${BOT_HANDLE} $2 @rep`, target: { tweetId: rec.id, type: "replied_to" } });
  await engine.tick();
  // 0.001 ETH, not 0.0004. The min stake is a DOLLAR policy ($1), so a
  // native-denominated stake sitting near it flips in and out of validity as
  // the price moves — 0.0004 ETH was $1.001 at one run's price and $0.99 at
  // the next, and the engine correctly declined the second in silence.
  x.queueMention({ ...user("erin"), text: `@${BOT_HANDLE} 0.001 @opa`, target: { tweetId: rec.id, type: "replied_to" } });
  await engine.tick();

  const bets = await store.listBets(rec.id);
  console.log(`  ${bets.length} participant trades recorded`);
  for (const b of bets) {
    console.log(`    @${b.handle} side ${b.side} $${b.amountUsd.toFixed(2)} -> ${b.tokensOut} tokens`);
    assert.ok(b.tokensOut > 0, `tokensOut must be real, got ${b.tokensOut} for @${b.handle}`);
  }
  assert.equal(bets.length, 2, "both stakes landed");

  // ---- 3. odds -------------------------------------------------------------
  const odds = await chain.getOdds(rec.chainRefs);
  console.log(
    `\n[3/4] odds: ${Math.round(odds.impliedA * 100)}% @opa  ($${odds.raisedUsd[0].toFixed(2)} / $${odds.raisedUsd[1].toFixed(2)})`,
  );

  if (OPEN_ONLY) {
    console.log(
      `\nleaving ${rec.id} OPEN until ${new Date(rec.settlesAtMs).toISOString()} (RATIO_SIM_OPEN_ONLY)`,
    );
    console.log("engine + real Base Sepolia: market live, settlement skipped ✅");
    return;
  }

  // ---- 4. settlement: likes verdict -> resolve -> migrate -> claim ---------
  const waitMs = rec.settlesAtMs - clock() + 2_000;
  if (waitMs > 0) {
    console.log(`\n  waiting ${Math.ceil(waitMs / 1000)}s for the market to close…`);
    await new Promise((r) => setTimeout(r, waitMs));
  }
  console.log("\n[4/4] settling on likes…");
  x.setLikes(sideA.tweetId, 40);
  x.setLikes(sideB.tweetId, 900); // side B ratios the original
  await engine.resolveDueMarkets();

  const settled = await store.getMarketByTweet(rec.id);
  assert.equal(settled!.status, "settled", "market settled");
  assert.equal(settled!.winner, "b", "side B won on likes");
  console.log(`  settled: @rep wins, ${settled!.likesBFinal} vs ${settled!.likesAFinal} likes`);

  console.log("\nengine + real Base Sepolia: full loop green ✅");
}

main().catch((err) => {
  console.error("\nsim-evm failed:", err);
  process.exit(1);
});
