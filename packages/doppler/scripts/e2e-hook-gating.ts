/**
 * THE question (winny, 2026-08-11): is the prediction hook's sell
 * rejection unconditional, or gated on oracle state?
 *
 *   - If sells open up once the oracle is finalized, the rejection is
 *     state-gated and a void path might exist (or be negotiable).
 *   - If sells are rejected in every state, there is NO on-chain exit
 *     for a never-resolved (voided) market. Launch blocker → treasury
 *     refunds as the stopgap.
 *
 * Sequence: create market → buy both sides → SELL (expect HookRejected)
 * → finalize(winner A), NO migration → SELL winner side → SELL loser
 * side. Also probes buys post-finalize for completeness.
 *
 * Run: npm run hook-gating -w @ratio/doppler
 */
import { generateKeyPairSigner } from "@solana/kit";
import {
  curveSwapExactIn,
  deriveSolanaCpmmDeployment,
  DOPPLER_SOLANA_DEVNET_PROGRAM_ADDRESSES,
  initializer,
  trustedOracle,
} from "@whetstone-research/doppler-sdk/solana";

import { RatioMarketClient, WSOL_MINT, type PairMarketRefs } from "../src/pairMarket.js";
import { sendInstructions, type Clients } from "../src/tx.js";
import {
  createClients,
  ensureFunded,
  loadOrCreateKeypairBytes,
  sol,
} from "./helpers.js";

type Operator = Awaited<ReturnType<typeof loadOrCreateKeypairBytes>>;

async function attemptSwap(
  clients: Clients,
  operator: Operator,
  refs: PairMarketRefs,
  side: 0 | 1,
  direction: number,
  amountIn: bigint,
  label: string,
): Promise<string> {
  const deployment = await deriveSolanaCpmmDeployment(
    DOPPLER_SOLANA_DEVNET_PROGRAM_ADDRESSES,
  );
  const s = refs.outcomes[side];
  try {
    const swap = await curveSwapExactIn({
      deployment: {
        ...deployment,
        dopplerLaunchHookV1Program: initializer.PREDICTION_HOOK_PROGRAM_ID,
      },
      launch: s.launch,
      launchAuthority: s.launchAuthority,
      baseVault: s.baseVault,
      quoteVault: s.quoteVault,
      launchFeeState: s.launchFeeState,
      baseMint: s.baseMint,
      quoteMint: refs.quoteMint,
      payer: operator,
      amountIn,
      minAmountOut: 0n,
      tradeDirection: direction as 0 | 1,
      remainingAccounts: [refs.oracleState],
      wrapSol: direction === initializer.TRADE_DIRECTION_BUY,
    });
    await sendInstructions({
      clients,
      payer: operator,
      instructions: swap.instructions,
      label,
    });
    return "ALLOWED";
  } catch (err) {
    const msg = String((err as Error).message ?? err);
    const cause = String((err as { cause?: unknown }).cause ?? "");
    if (msg.includes("6016") || cause.includes("6016") || msg.includes("Hook rejected"))
      return "HOOK REJECTED (6016)";
    return `ERROR: ${msg.slice(0, 120)}`;
  }
}

async function main() {
  const clients = createClients();
  const operator = await loadOrCreateKeypairBytes(
    new URL("./.keys/devnet-payer.json", import.meta.url).pathname,
  );
  console.log("operator:", operator.address);
  console.log("balance:", sol(await ensureFunded(clients, operator.address, 0.55)));

  const beneficiary = await generateKeyPairSigner();
  const client = await RatioMarketClient.create({ clients, operator });

  console.log("\n[1/5] market…");
  const refs = await client.createMarket({
    nonce: BigInt(Date.now()),
    quoteMint: WSOL_MINT,
    swapFeeBps: 125,
    feeBeneficiaries: [{ wallet: beneficiary.address, shareBps: 10_000 }],
    outcomes: [
      { label: "A", symbol: "RTOA" },
      { label: "B", symbol: "RTOB" },
    ],
  });

  console.log("\n[2/5] buy both sides…");
  const buyA = await client.placeBet({ refs, side: 0, amountIn: 20_000_000n, bettor: operator, wrapSol: true });
  await client.placeBet({ refs, side: 1, amountIn: 15_000_000n, bettor: operator, wrapSol: true });
  const tokensA = BigInt(
    (await clients.rpc.getTokenAccountBalance(buyA.outcomeTokenAccount).send()).value.amount,
  );

  console.log("\n[3/5] SELL side A, oracle UNRESOLVED:");
  console.log("  →", await attemptSwap(clients, operator, refs, 0, initializer.TRADE_DIRECTION_SELL as number, tokensA / 4n, "sell A pre-finalize"));

  console.log("\n[4/5] finalize(winner = A), NO migration…");
  await sendInstructions({
    clients,
    payer: operator,
    label: "finalize only",
    instructions: [
      trustedOracle.getFinalizeInstruction({
        oracleAuthority: operator,
        oracleState: refs.oracleState,
        winningMint: refs.outcomes[0].baseMint,
      }),
    ],
  });

  console.log("\n[5/5] post-finalize probes:");
  console.log("  sell WINNER side (A) →", await attemptSwap(clients, operator, refs, 0, initializer.TRADE_DIRECTION_SELL as number, tokensA / 4n, "sell A post-finalize"));
  console.log("  sell LOSER side (B)  →", await attemptSwap(clients, operator, refs, 1, initializer.TRADE_DIRECTION_SELL as number, 1_000_000n, "sell B post-finalize"));
  console.log("  buy  side A          →", await attemptSwap(clients, operator, refs, 0, initializer.TRADE_DIRECTION_BUY as number, 2_000_000n, "buy A post-finalize"));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
