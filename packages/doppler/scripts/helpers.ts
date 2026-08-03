/**
 * Devnet script-only helpers: keypair persistence + faucet funding.
 * Tx plumbing lives in ../src/tx.ts (shared with the client).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import {
  airdropFactory,
  createKeyPairSignerFromBytes,
  lamports,
  type Address,
  type TransactionSigner,
} from "@solana/kit";

import type { Clients } from "../src/tx.js";

export { createClients, sendInstructions } from "../src/tx.js";

/**
 * Load a persisted 64-byte keypair file (solana-keygen convention), or
 * generate + persist one. Devnet only — never for real funds.
 */
export async function loadOrCreateKeypairBytes(
  path: string,
): Promise<TransactionSigner> {
  if (existsSync(path)) {
    const bytes = new Uint8Array(JSON.parse(readFileSync(path, "utf8")));
    return createKeyPairSignerFromBytes(bytes);
  }
  const { generateKeyPair } = await import("node:crypto");
  // ed25519+jwk overloads confuse tsc's overload resolution; runtime is fine.
  const genKeyPair = generateKeyPair as unknown as (
    type: string,
    options: object,
    callback: (err: Error | null, publicKey: unknown, privateKey: unknown) => void,
  ) => void;
  const raw: { privateKey: Uint8Array; publicKey: Uint8Array } =
    await new Promise((resolve, reject) => {
      genKeyPair(
        "ed25519",
        {
          privateKeyEncoding: { format: "jwk" },
          publicKeyEncoding: { format: "jwk" },
        },
        (err, publicKey, privateKey) => {
          if (err) return reject(err);
          const priv = privateKey as { d: string };
          const pub = publicKey as { x: string };
          resolve({
            privateKey: Buffer.from(priv.d, "base64url"),
            publicKey: Buffer.from(pub.x, "base64url"),
          });
        },
      );
    });
  const bytes = new Uint8Array(64);
  bytes.set(raw.privateKey, 0);
  bytes.set(raw.publicKey, 32);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(Array.from(bytes)));
  return createKeyPairSignerFromBytes(bytes);
}

/** Airdrop devnet SOL until the account holds at least minSol. */
export async function ensureFunded(
  clients: Clients,
  addr: Address,
  minSol: number,
): Promise<bigint> {
  const min = BigInt(Math.round(minSol * 1e9));
  const balance = async () =>
    (await clients.rpc.getBalance(addr, { commitment: "confirmed" }).send())
      .value;
  let current = await balance();
  if (current >= min) return current;

  const airdrop = airdropFactory(clients);
  for (let attempt = 0; attempt < 5 && current < min; attempt++) {
    try {
      await airdrop({
        commitment: "confirmed",
        lamports: lamports(min - current),
        recipientAddress: addr,
      });
    } catch (err) {
      console.warn(
        `  airdrop attempt ${attempt + 1} failed: ${(err as Error).message}`,
      );
      await new Promise((r) => setTimeout(r, 2000));
    }
    current = await balance();
  }
  if (current < min) {
    throw new Error(
      `Devnet faucet exhausted. Fund ${addr} manually (solana transfer from ~/.config/solana/id.json) and re-run.`,
    );
  }
  return current;
}

export function sol(lamportsValue: bigint): string {
  return (Number(lamportsValue) / 1e9).toFixed(4) + " SOL";
}
