/**
 * Transaction plumbing shared by the poll-market client and scripts.
 * No filesystem access here — keypair loading lives in scripts/agent code.
 */
import {
  appendTransactionMessageInstructions,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  createTransactionMessage,
  generateKeyPairSigner,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  pipe,
  sendAndConfirmTransactionFactory,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type Instruction,
  type TransactionSigner,
} from "@solana/kit";

import { initializer } from "@whetstone-research/doppler-sdk/solana";

export function createClients(opts?: { rpcUrl?: string; wsUrl?: string }) {
  const rpcUrl =
    opts?.rpcUrl ??
    process.env.SOLANA_RPC_URL ??
    "https://api.devnet.solana.com";
  const wsUrl =
    opts?.wsUrl ?? process.env.SOLANA_WS_URL ?? "wss://api.devnet.solana.com";
  return {
    rpc: createSolanaRpc(rpcUrl),
    rpcSubscriptions: createSolanaRpcSubscriptions(wsUrl),
    rpcUrl,
  };
}

export type Clients = ReturnType<typeof createClients>;

export async function signInstructions({
  clients,
  payer,
  instructions,
}: {
  clients: Clients;
  payer: TransactionSigner;
  instructions: Instruction[];
}) {
  const { value: latestBlockhash } = await clients.rpc
    .getLatestBlockhash()
    .send();
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (tx) => setTransactionMessageFeePayerSigner(payer, tx),
    (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
    (tx) => appendTransactionMessageInstructions(instructions, tx),
  );
  return signTransactionMessageWithSigners(message);
}

/**
 * Public devnet RPC rate-limits aggressively. A 429 means the request was
 * rejected before executing, so retrying is safe; re-sending an identical
 * signed tx is also idempotent (nodes dedup by signature).
 */
export async function withRetry429<T>(
  fn: () => Promise<T>,
  label = "rpc",
  attempts = 4,
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      const msg = String((err as Error).message ?? err);
      if (
        !/429|Too Many Requests|WebSocket failed|WebSocket was closed|ECONNRESET|fetch failed|socket hang up/i.test(
          msg,
        )
      )
        throw err;
      lastErr = err;
      const delay = 3000 * 2 ** i;
      console.warn(
        `  [${label}] transient RPC failure (${msg.slice(0, 60)}), retrying in ${delay / 1000}s…`,
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

export async function sendInstructions(opts: {
  clients: Clients;
  payer: TransactionSigner;
  instructions: Instruction[];
  label?: string;
}): Promise<string> {
  return withRetry429(() => sendInstructionsOnce(opts), opts.label ?? "tx");
}

async function sendInstructionsOnce({
  clients,
  payer,
  instructions,
  label,
}: {
  clients: Clients;
  payer: TransactionSigner;
  instructions: Instruction[];
  label?: string;
}): Promise<string> {
  const signed = await signInstructions({ clients, payer, instructions });
  const sendAndConfirm = sendAndConfirmTransactionFactory(clients);
  try {
    await sendAndConfirm(signed as Parameters<typeof sendAndConfirm>[0], {
      commitment: "confirmed",
    });
  } catch (err) {
    // Kit errors bury program logs; surface them before rethrowing.
    const sim = await clients.rpc
      .simulateTransaction(getBase64EncodedWireTransaction(signed), {
        encoding: "base64",
        replaceRecentBlockhash: true,
      })
      .send();
    console.error(`[${label ?? "tx"}] failed. Simulation logs:`);
    for (const line of sim.value.logs ?? []) console.error("  " + line);
    throw err;
  }
  return getSignatureFromTransaction(signed);
}

async function waitForSlotAfter(clients: Clients, slot: bigint) {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const current = await clients.rpc
        .getSlot({ commitment: "confirmed" })
        .send();
      if (BigInt(current) > slot) return;
    } catch {
      // transient RPC failure — just wait and poll again
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("Timed out waiting for lookup table warmup slot");
}

/** initialize_launch exceeds the tx size limit without an address lookup table. */
export async function sendInitializeLaunchWithLookupTable({
  clients,
  payer,
  instruction,
  label = "initialize_launch",
}: {
  clients: Clients;
  payer: TransactionSigner;
  instruction: Instruction;
  label?: string;
}): Promise<string> {
  const recentSlot = await withRetry429(
    () => clients.rpc.getSlot({ commitment: "finalized" }).send(),
    `${label} getSlot`,
  );
  const addresses = initializer.getInstructionLookupTableAddresses(instruction);
  const authority = await generateKeyPairSigner();
  const lookupTable =
    await initializer.buildAddressLookupTableSetupInstructions({
      authority,
      payer,
      recentSlot,
      addresses,
    });

  await sendInstructions({
    clients,
    payer,
    instructions: [
      lookupTable.createInstruction,
      ...lookupTable.extendInstructions,
    ],
    label: `${label} ALT setup`,
  });
  const setupSlot = await clients.rpc
    .getSlot({ commitment: "confirmed" })
    .send();
  await waitForSlotAfter(clients, BigInt(setupSlot));

  return withRetry429(async () => {
    const { value: latestBlockhash } = await clients.rpc
      .getLatestBlockhash()
      .send();
    const message = initializer.compressTransactionMessageWithLookupTable(
      pipe(
        createTransactionMessage({ version: 0 }),
        (tx) => setTransactionMessageFeePayerSigner(payer, tx),
        (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
        (tx) => appendTransactionMessageInstructions([instruction], tx),
      ),
      lookupTable,
    );
    const signed = await signTransactionMessageWithSigners(message);
    const sendAndConfirm = sendAndConfirmTransactionFactory(clients);
    await sendAndConfirm(signed as Parameters<typeof sendAndConfirm>[0], {
      commitment: "confirmed",
    });
    return getSignatureFromTransaction(signed);
  }, `${label} send`);
}
