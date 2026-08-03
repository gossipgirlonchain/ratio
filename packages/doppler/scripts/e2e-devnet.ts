/**
 * ratio × Doppler devnet e2e, driven through RatioMarketClient:
 *
 *   create oracle + A/B curves (FIVE fee beneficiaries, the confirmed max)
 *   → stake both sides → finalize(winner) → migrate → claim
 *
 * Verifies the five-way immutable split wires through launch, and that the
 * pot math still nets out to (1 - SWAP_FEE_BPS) of staked volume.
 *
 * Quote = WSOL (devnet USDC faucets are flaky; quote mint is config).
 * Run: npm run e2e -w @ratio/doppler
 */
import { generateKeyPairSigner } from "@solana/kit";

import { RatioMarketClient, WSOL_MINT } from "../src/pairMarket.js";
import {
  createClients,
  ensureFunded,
  loadOrCreateKeypairBytes,
  sol,
} from "./helpers.js";

// Locked 2026-07-31 (packages/config is the source of truth; mirrored here
// because this package must not depend on app config).
const SWAP_FEE_BPS = 125; // 1.25%
const FEE_SHARE_BPS = {
  doppler: 750, // 7.5%
  treasury: 4_500, // 45%
  sideA: 1_800, // 18%
  sideB: 1_800, // 18%
  tagger: 1_150, // 11.5%
};
const STAKE_ON_A = 80_000_000n; // 0.08 SOL
const STAKE_ON_B = 30_000_000n; // 0.03 SOL

async function main() {
  const clients = createClients();
  const operator = await loadOrCreateKeypairBytes(
    new URL("./.keys/devnet-payer.json", import.meta.url).pathname,
  );
  console.log("Operator (oracle authority/bettor):", operator.address);
  console.log("Balance:", sol(await ensureFunded(clients, operator.address, 1.5)));

  // Five distinct recipient wallets, as production will have.
  const [doppler, treasury, authorA, authorB, tagger] = await Promise.all(
    Array.from({ length: 5 }, () => generateKeyPairSigner()),
  );
  const client = await RatioMarketClient.create({ clients, operator });

  console.log("\n[1/5] Creating market (oracle + A/B curves, 5 beneficiaries)…");
  const refs = await client.createMarket({
    nonce: BigInt(Date.now()), // production: side B's tweet id
    quoteMint: WSOL_MINT,
    swapFeeBps: SWAP_FEE_BPS,
    feeBeneficiaries: [
      { wallet: doppler.address, shareBps: FEE_SHARE_BPS.doppler },
      { wallet: treasury.address, shareBps: FEE_SHARE_BPS.treasury },
      { wallet: authorA.address, shareBps: FEE_SHARE_BPS.sideA },
      { wallet: authorB.address, shareBps: FEE_SHARE_BPS.sideB },
      { wallet: tagger.address, shareBps: FEE_SHARE_BPS.tagger },
    ],
    outcomes: [
      { label: "A", symbol: "RTOA" },
      { label: "B", symbol: "RTOB" },
    ],
  });
  console.log("  oracle:", refs.oracleState);
  console.log("  market:", refs.market);

  console.log("\n[2/5] Staking…");
  const stakeA = await client.placeBet({
    refs,
    side: 0,
    amountIn: STAKE_ON_A,
    bettor: operator,
    wrapSol: true,
  });
  await client.placeBet({
    refs,
    side: 1,
    amountIn: STAKE_ON_B,
    bettor: operator,
    wrapSol: true,
  });
  const odds = await client.getOdds(refs);
  console.log(
    `  Pot shares: A ${(odds.implied0 * 100).toFixed(1)}% / B ${((1 - odds.implied0) * 100).toFixed(1)}% ` +
      `(raised ${sol(odds.raised[0])} vs ${sol(odds.raised[1])})`,
  );

  console.log("\n[3/5] Settling: A wins (finalize → migrate both)…");
  await client.resolveAndMigrate({ refs, winner: 0 });
  const market = await client.getMarketState(refs);
  const staked = STAKE_ON_A + STAKE_ON_B;
  const expectedPot = (staked * BigInt(10_000 - SWAP_FEE_BPS)) / 10_000n;
  console.log(
    `  Pot: ${sol(market.totalPot)} (expected ≈ ${sol(expectedPot)} = staked − 1.25% fee)`,
  );

  console.log("\n[4/5] Claiming…");
  const winnerBalance = BigInt(
    (
      await clients.rpc.getTokenAccountBalance(stakeA.outcomeTokenAccount).send()
    ).value.amount,
  );
  const quoteBefore = BigInt(
    (
      await clients.rpc.getTokenAccountBalance(stakeA.quoteTokenAccount).send()
    ).value.amount,
  );
  await client.claim({
    refs,
    winner: 0,
    claimer: operator,
    claimerWinnerAta: stakeA.outcomeTokenAccount,
    claimerQuoteAta: stakeA.quoteTokenAccount,
    burnAmount: winnerBalance,
  });
  const payout =
    BigInt(
      (
        await clients.rpc.getTokenAccountBalance(stakeA.quoteTokenAccount).send()
      ).value.amount,
    ) - quoteBefore;

  console.log("\n[5/5] ════════ RESULT ════════");
  console.log(`  Staked on A: ${sol(STAKE_ON_A)}   Staked on B: ${sol(STAKE_ON_B)}`);
  console.log(`  Pot:         ${sol(market.totalPot)}`);
  console.log(`  A-payout:    ${sol(payout)}`);
  console.log(`  Multiple:    ${(Number(payout) / Number(STAKE_ON_A)).toFixed(3)}×`);
  const potOk =
    market.totalPot >= expectedPot - 10n && market.totalPot <= expectedPot + 10n;
  console.log(`  Fee math:    ${potOk ? "pot = staked − 1.25% ✅" : "UNEXPECTED POT ❌"}`);
  if (!potOk) process.exit(1);
  console.log(
    "\nFull lifecycle with FIVE fee beneficiaries verified on devnet ✅",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
