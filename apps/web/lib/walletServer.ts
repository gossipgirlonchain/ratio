/**
 * Server-side wallet plumbing for the logged-in viewer.
 *
 * Identity: the Privy access token from the client is VERIFIED here
 * (never trust a client-passed x id for money paths), then resolved to
 * the numeric X id — the same durable key the agent's wallets hang off.
 *
 * Provisioning mirrors apps/agent/src/privyWallets.ts exactly: wallets
 * table first, Privy create with the same idempotency key second, so
 * web and agent can never mint two wallets for one person.
 *
 * Denomination: devnet quote is WSOL at LAMPORTS_PER_USD (the same rate
 * DopplerMarketChain trades at), so balances and sends are USD-labeled
 * SOL. USDC production flips this to an SPL transfer at 1e6/$.
 */
import "server-only";

import { PrivyClient } from "@privy-io/server-auth";
import { getTransferSolInstruction } from "@solana-program/system";
import {
  address,
  appendTransactionMessageInstructions,
  createSolanaRpc,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  lamports,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type Address,
  type SignatureBytes,
  type TransactionSigner,
} from "@solana/kit";

import { supabaseAdmin } from "./supabaseServer";

import { LAMPORTS_PER_USD } from "@ratio/config";
export { LAMPORTS_PER_USD };

const PRIVY_API = "https://api.privy.io/v1";

let privyClient: PrivyClient | null = null;
function privy(): PrivyClient {
  if (!privyClient) {
    const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
    const secret = process.env.PRIVY_APP_SECRET;
    if (!appId || !secret) throw new Error("privy server creds not configured");
    privyClient = new PrivyClient(appId, secret);
  }
  return privyClient;
}

function rpc() {
  return createSolanaRpc(process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com");
}

export interface Viewer {
  xUserId: string;
  handle: string;
}

/** Verify the Privy bearer token and resolve the linked X identity. */
export async function verifyViewer(authHeader: string | null): Promise<Viewer | null> {
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return null;
  try {
    const claims = await privy().verifyAuthToken(token);
    const user = await privy().getUser(claims.userId);
    const tw = user.twitter;
    if (!tw?.subject) return null;
    return { xUserId: tw.subject, handle: tw.username ?? tw.subject };
  } catch {
    return null;
  }
}

interface WalletRow {
  x_user_id: string;
  privy_wallet_id: string;
  address: string;
}

async function privyRest<T>(path: string, body: unknown, idempotencyKey?: string): Promise<T> {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID!;
  const secret = process.env.PRIVY_APP_SECRET!;
  const res = await fetch(`${PRIVY_API}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${appId}:${secret}`).toString("base64")}`,
      "privy-app-id": appId,
      "content-type": "application/json",
      ...(idempotencyKey ? { "privy-idempotency-key": idempotencyKey } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`privy ${path} -> ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return (await res.json()) as T;
}

export async function getOrCreateWallet(xUserId: string): Promise<WalletRow> {
  const db = supabaseAdmin();
  const sel = await db.from("wallets").select().eq("x_user_id", xUserId).maybeSingle();
  if (sel.error) throw new Error(`wallets lookup: ${sel.error.message}`);
  if (sel.data) return sel.data as WalletRow;

  // Privy create is idempotent on this key (same key as the agent: one
  // wallet per person, ever), and the write is an UPSERT on the primary
  // key — so a concurrent provision from any surface converges on the
  // same row instead of racing an insert.
  const created = await privyRest<{ id: string; address: string }>(
    "/wallets",
    { chain_type: "solana" },
    `ratio-wallet-${xUserId}`,
  );
  const up = await db
    .from("wallets")
    .upsert(
      { x_user_id: xUserId, privy_wallet_id: created.id, address: created.address, created_at_ms: Date.now() },
      { onConflict: "x_user_id", ignoreDuplicates: false },
    )
    .select()
    .maybeSingle();
  if (up.error) throw new Error(`wallets upsert: ${up.error.message}`);
  if (!up.data) throw new Error("wallets upsert returned nothing");
  return up.data as WalletRow;
}

export async function balanceUsd(walletAddress: string): Promise<number> {
  const { value } = await rpc().getBalance(address(walletAddress)).send();
  return Number(value) / Number(LAMPORTS_PER_USD);
}

/**
 * Lamports parked as rent in the wallet's token accounts (outcome tokens,
 * WSOL). At the devnet sim rate rent looks big in USD — showing it is the
 * difference between "numbers add up" and "where did $8 go".
 */
export async function rentUsd(walletAddress: string): Promise<number> {
  const { value } = await rpc()
    .getTokenAccountsByOwner(
      address(walletAddress),
      { programId: address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA") },
      { encoding: "jsonParsed" },
    )
    .send();
  let lamports = 0n;
  for (const acc of value) lamports += BigInt(acc.account.lamports);
  return Number(lamports) / Number(LAMPORTS_PER_USD);
}

export function privySigner(walletId: string, walletAddress: string): TransactionSigner {
  return {
    address: walletAddress as Address,
    async signTransactions(transactions) {
      const out: Array<Record<string, SignatureBytes>> = [];
      for (const tx of transactions) {
        const r = await privyRest<{ data: { signature: string } }>(`/wallets/${walletId}/rpc`, {
          method: "signMessage",
          params: {
            message: Buffer.from(tx.messageBytes as unknown as Uint8Array).toString("base64"),
            encoding: "base64",
          },
        });
        out.push({
          [walletAddress]: new Uint8Array(Buffer.from(r.data.signature, "base64")) as SignatureBytes,
        });
      }
      return out;
    },
  };
}

/** USD-denominated transfer out of the viewer's wallet. Returns the tx signature. */
export async function sendUsd(wallet: WalletRow, to: string, amountUsd: number): Promise<string> {
  const client = rpc();
  const signer = privySigner(wallet.privy_wallet_id, wallet.address);
  const { value: latestBlockhash } = await client.getLatestBlockhash().send();
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (tx) => setTransactionMessageFeePayerSigner(signer, tx),
    (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
    (tx) =>
      appendTransactionMessageInstructions(
        [
          getTransferSolInstruction({
            source: signer,
            destination: address(to),
            amount: lamports(BigInt(Math.round(amountUsd * Number(LAMPORTS_PER_USD)))),
          }),
        ],
        tx,
      ),
  );
  const signed = await signTransactionMessageWithSigners(message);
  const sig = await client
    .sendTransaction(getBase64EncodedWireTransaction(signed), { encoding: "base64" })
    .send();
  return sig as string;
}
