/** Live Privy wallet proof, devnet only:
 * 1. provision wallet for a throwaway x id (idempotency checked)
 * 2. fund it 0.01 devnet SOL from the local CLI wallet
 * 3. send 1000 lamports back, SIGNED BY PRIVY, confirm on chain
 */
import { readFileSync } from "node:fs";
import { getTransferSolInstruction } from "@solana-program/system";
import { createKeyPairSignerFromBytes, lamports, address } from "@solana/kit";
import { createClients, sendInstructions } from "@ratio/doppler/tx";
import { PrivyWalletProvider } from "../src/privyWallets.js";

async function main() {
  const provider = new PrivyWalletProvider(
    { appId: process.env.PRIVY_APP_ID!, appSecret: process.env.PRIVY_APP_SECRET! },
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
  );
  const xid = `smoke:${Date.now()}`;
  const w1 = await provider.getWallet(xid);
  const w2 = await provider.getWallet(xid);
  console.log("wallet:", w1.address, "| idempotent:", w1.address === w2.address);

  const clients = createClients();
  const cli = await createKeyPairSignerFromBytes(
    new Uint8Array(JSON.parse(readFileSync(`${process.env.HOME}/.config/solana/id.json`, "utf8"))),
  );
  console.log("funding from", cli.address);
  await sendInstructions({
    clients, payer: cli, label: "fund privy wallet",
    instructions: [getTransferSolInstruction({ source: cli, destination: address(w1.address), amount: lamports(10_000_000n) })],
  });
  const signer = provider.signerFor(w1.address);
  await sendInstructions({
    clients, payer: signer, label: "privy-signed send-back",
    instructions: [getTransferSolInstruction({ source: signer, destination: cli.address, amount: lamports(1_000n) })],
  });
  console.log("PRIVY-SIGNED devnet transaction CONFIRMED");
}
main().catch((e) => { console.error(e); process.exit(1); });
