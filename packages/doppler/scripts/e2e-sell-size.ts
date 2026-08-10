/**
 * Devnet test: does ONE atomic transaction fit —
 *   curve sell + five surcharge transfers (the app-layer exit fee,
 *   split at source to the same five recipients)?
 *
 * Five beneficiaries was the launch-time limit precisely because of
 * transaction size, so this is measured on-chain, not reasoned about.
 * Reports wire bytes vs the 1232-byte packet limit for:
 *   A) sell + 5 transfers (recipient ATAs pre-created — production
 *      creates them at market creation)
 *   B) sell + 5 idempotent ATA-creates + 5 transfers (worst case)
 * then LANDS variant A.
 *
 * Run: npm run sell-size -w @ratio/doppler
 */
import {
  appendTransactionMessageInstructions,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  generateKeyPairSigner,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type Instruction,
} from "@solana/kit";
import {
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstructionAsync,
  getTransferInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import {
  curveSwapExactIn,
  deriveSolanaCpmmDeployment,
  DOPPLER_SOLANA_DEVNET_PROGRAM_ADDRESSES,
  initializer,
} from "@whetstone-research/doppler-sdk/solana";

import { RatioMarketClient, WSOL_MINT } from "../src/pairMarket.js";
import { sendInstructions } from "../src/tx.js";
import {
  createClients,
  ensureFunded,
  loadOrCreateKeypairBytes,
  sol,
} from "./helpers.js";

const SWAP_FEE_BPS = 125;
const SHARES = [750, 4_500, 1_800, 1_800, 1_150]; // doppler/treasury/A/B/tagger

const wireBytes = async (
  clients: ReturnType<typeof createClients>,
  payer: Awaited<ReturnType<typeof loadOrCreateKeypairBytes>>,
  ixs: Instruction[],
): Promise<number> => {
  const { value: bh } = await clients.rpc.getLatestBlockhash().send();
  const msg = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(payer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(bh, m),
    (m) => appendTransactionMessageInstructions(ixs, m),
  );
  const signed = await signTransactionMessageWithSigners(msg);
  return Buffer.from(getBase64EncodedWireTransaction(signed), "base64").length;
};

async function main() {
  const clients = createClients();
  const operator = await loadOrCreateKeypairBytes(
    new URL("./.keys/devnet-payer.json", import.meta.url).pathname,
  );
  console.log("operator:", operator.address);
  console.log("balance:", sol(await ensureFunded(clients, operator.address, 0.35)));

  const recipients = await Promise.all(
    Array.from({ length: 5 }, () => generateKeyPairSigner()),
  );
  const client = await RatioMarketClient.create({ clients, operator });

  console.log("\n[1/4] market (5 beneficiaries)…");
  const refs = await client.createMarket({
    nonce: BigInt(Date.now()),
    quoteMint: WSOL_MINT,
    swapFeeBps: SWAP_FEE_BPS,
    feeBeneficiaries: recipients.map((r, i) => ({
      wallet: r.address,
      shareBps: SHARES[i]!,
    })),
    outcomes: [
      { label: "A", symbol: "RTOA" },
      { label: "B", symbol: "RTOB" },
    ],
  });

  console.log("\n[2/4] buy side A (0.03 SOL)…");
  const buy = await client.placeBet({
    refs,
    side: 0,
    amountIn: 30_000_000n,
    bettor: operator,
    wrapSol: true,
  });
  const tokenBalance = BigInt(
    (await clients.rpc.getTokenAccountBalance(buy.outcomeTokenAccount).send())
      .value.amount,
  );

  console.log("\n[3/4] recipient WSOL ATAs (setup — production does this at market creation)…");
  const ataIxs = [];
  const recipientAtas = [];
  for (const r of recipients) {
    const [ata] = await findAssociatedTokenPda({
      mint: WSOL_MINT,
      owner: r.address,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });
    recipientAtas.push(ata);
    ataIxs.push(
      await getCreateAssociatedTokenIdempotentInstructionAsync({
        payer: operator,
        mint: WSOL_MINT,
        owner: r.address,
      }),
    );
  }
  await sendInstructions({
    clients,
    payer: operator,
    instructions: ataIxs,
    label: "recipient ATAs",
  });

  console.log("\n[4/4] THE atomic tx: sell half + 5 surcharge transfers…");
  const deployment = await deriveSolanaCpmmDeployment(
    DOPPLER_SOLANA_DEVNET_PROGRAM_ADDRESSES,
  );
  const side = refs.outcomes[0];
  const sellSwap = await curveSwapExactIn({
    deployment: {
      ...deployment,
      dopplerLaunchHookV1Program: initializer.PREDICTION_HOOK_PROGRAM_ID,
    },
    launch: side.launch,
    launchAuthority: side.launchAuthority,
    baseVault: side.baseVault,
    quoteVault: side.quoteVault,
    launchFeeState: side.launchFeeState,
    baseMint: side.baseMint,
    quoteMint: refs.quoteMint,
    payer: operator,
    amountIn: tokenBalance / 2n,
    minAmountOut: 0n,
    tradeDirection: initializer.TRADE_DIRECTION_SELL as 0 | 1,
    remainingAccounts: [refs.oracleState],
    wrapSol: false,
  });
  // surcharge slices: amounts are irrelevant to SIZE — tiny fixed slices
  const transferIxs = recipientAtas.map((ata) =>
    getTransferInstruction({
      source: sellSwap.userQuoteAccount,
      destination: ata,
      authority: operator,
      amount: 1_000n,
    }),
  );
  const atomicIxs = [...sellSwap.instructions, ...transferIxs];

  const sizeA = await wireBytes(clients, operator, atomicIxs);
  const sizeB = await wireBytes(clients, operator, [
    ...sellSwap.instructions,
    ...ataIxs,
    ...transferIxs,
  ]);
  console.log(`  variant A (sell + 5 transfers):            ${sizeA} bytes ${sizeA <= 1232 ? "≤ 1232 ✅" : "> 1232 ❌"}`);
  console.log(`  variant B (+ 5 inline ATA creates):        ${sizeB} bytes ${sizeB <= 1232 ? "≤ 1232 ✅" : "> 1232 ❌"}`);

  if (sizeA <= 1232) {
    const sig = await sendInstructions({
      clients,
      payer: operator,
      instructions: atomicIxs,
      label: "ATOMIC sell + 5 surcharge transfers",
    });
    console.log(`  LANDED on devnet: ${sig}`);
    const oneRecipient = BigInt(
      (await clients.rpc.getTokenAccountBalance(recipientAtas[0]!).send()).value
        .amount,
    );
    console.log(`  recipient[0] surcharge received: ${oneRecipient} lamports (expected 1000)`);
  } else {
    console.log("  NOT sending — over the packet limit. Lookup table or split needed.");
  }
  console.log(`\nheadroom (variant A): ${1232 - sizeA} bytes`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
