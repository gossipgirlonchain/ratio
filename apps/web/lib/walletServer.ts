/**
 * Server-side wallet IDENTITY for the logged-in viewer. Chain operations
 * live behind MarketChain (lib/chain.ts) — this file knows about Privy and
 * about our wallets table, and nothing about how money moves.
 *
 * Identity: the Privy access token from the client is VERIFIED here
 * (never trust a client-passed x id for money paths), then resolved to
 * the numeric X id — the same durable key the agent's wallets hang off.
 *
 * Provisioning mirrors apps/agent/src/privyWallets.ts exactly: wallets
 * table first, Privy create with the same idempotency key second, so
 * web and agent can never mint two wallets for one person.
 */
import "server-only";

import { PrivyClient } from "@privy-io/server-auth";
import type { Address, SignatureBytes, TransactionSigner } from "@solana/kit";
import { hashMessage, hashTypedData, type Account } from "viem";
import { toAccount } from "viem/accounts";

import { supabaseAdmin } from "./supabaseServer";

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

/** address -> privy wallet id, cached per process for both chains. */
const walletIdByAddress = new Map<string, string>();

export interface WalletRow {
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

export async function getOrCreateWallet(xUserId: string, handle?: string): Promise<WalletRow> {
  const db = supabaseAdmin();
  // Scoped to solana: since 0002 a person can hold one wallet per chain, so an
  // unscoped lookup starts returning two rows and maybeSingle() throws.
  const sel = await db
    .from("wallets")
    .select()
    .eq("x_user_id", xUserId)
    .eq("chain", "solana")
    .maybeSingle();
  if (sel.error) throw new Error(`wallets lookup: ${sel.error.message}`);
  if (sel.data) {
    const row = sel.data as WalletRow & { handle?: string | null };
    // handles are display cache: keep it current on every login
    if (handle && row.handle !== handle) {
      void db
        .from("wallets")
        .update({ handle })
        .eq("x_user_id", xUserId)
        .eq("chain", "solana")
        .then(() => {});
    }
    return row;
  }

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
      {
        x_user_id: xUserId,
        chain: "solana",
        privy_wallet_id: created.id,
        address: created.address,
        created_at_ms: Date.now(),
        handle: handle ?? null,
      },
      // Must match the composite primary key from 0002; "x_user_id" alone is
      // no longer a unique constraint and PostgREST rejects it outright.
      { onConflict: "x_user_id,chain", ignoreDuplicates: false },
    )
    .select()
    .maybeSingle();
  if (up.error) throw new Error(`wallets upsert: ${up.error.message}`);
  if (!up.data) throw new Error("wallets upsert returned nothing");
  return up.data as WalletRow;
}

/** Solana signatures are ed25519 over the message bytes, so Privy's
 * signMessage maps 1:1 onto a partial signer with no round trip through
 * full-transaction serialization. */
async function signWithPrivy(
  walletId: string,
  walletAddress: string,
  transactions: readonly { messageBytes: unknown }[],
): Promise<Array<Record<string, SignatureBytes>>> {
  const out: Array<Record<string, SignatureBytes>> = [];
  for (const tx of transactions) {
    const r = await privyRest<{ data: { signature: string } }>(`/wallets/${walletId}/rpc`, {
      method: "signMessage",
      params: {
        message: Buffer.from(tx.messageBytes as Uint8Array).toString("base64"),
        encoding: "base64",
      },
    });
    out.push({
      [walletAddress]: new Uint8Array(Buffer.from(r.data.signature, "base64")) as SignatureBytes,
    });
  }
  return out;
}

/**
 * The EVM counterpart: a viem Account whose signatures come from Privy.
 * Same lazy address -> wallet-id lookup as the Solana signer below, because
 * MarketChain hands us an address and the id lives in the database.
 */
export function privyEvmAccount(walletAddress: string): Account {
  const lookup = async (): Promise<string> => {
    const cached = walletIdByAddress.get(walletAddress.toLowerCase());
    if (cached) return cached;
    const { data } = await supabaseAdmin()
      .from("wallets")
      .select()
      .eq("address", walletAddress)
      .eq("chain", "ethereum")
      .maybeSingle();
    if (!data) throw new Error(`no privy evm wallet for ${walletAddress}`);
    const id = (data as WalletRow).privy_wallet_id;
    walletIdByAddress.set(walletAddress.toLowerCase(), id);
    return id;
  };
  const rpc = async (method: string, params: unknown) => {
    const r = await privyRest<{ data: Record<string, string> }>(
      `/wallets/${await lookup()}/rpc`,
      { method, params },
    );
    return r.data;
  };
  return toAccount({
    address: walletAddress as `0x${string}`,
    async signMessage({ message }) {
      const { signature } = await rpc("secp256k1_sign", { hash: hashMessage(message) });
      return signature as `0x${string}`;
    },
    async signTransaction(transaction) {
      const { signed_transaction } = await rpc("eth_signTransaction", {
        transaction: hexifyTx(transaction),
      });
      return signed_transaction as `0x${string}`;
    },
    async signTypedData(typedData) {
      const { signature } = await rpc("secp256k1_sign", {
        hash: hashTypedData(typedData as never),
      });
      return signature as `0x${string}`;
    },
  });
}

/** Privy's JSON wants hex strings where viem hands us bigints. */
function hexifyTx(tx: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...tx };
  for (const k of ["value", "gas", "nonce", "maxFeePerGas", "maxPriorityFeePerGas", "gasPrice"]) {
    const v = out[k];
    if (typeof v === "bigint") out[k] = `0x${v.toString(16)}`;
    else if (typeof v === "number") out[k] = `0x${v.toString(16)}`;
  }
  return out;
}

/**
 * MarketChain resolves bettor and sponsor ADDRESSES to signers, and the
 * interface is synchronous — but mapping an address to its Privy wallet id
 * is a database read. So the lookup happens lazily inside signTransactions,
 * the same shape the agent's PrivyWalletProvider uses, and is cached per
 * process afterwards.
 */
export function privySignerByAddress(walletAddress: string): TransactionSigner {
  return {
    address: walletAddress as Address,
    async signTransactions(transactions) {
      let walletId = walletIdByAddress.get(walletAddress);
      if (!walletId) {
        const { data } = await supabaseAdmin()
          .from("wallets")
          .select()
          .eq("address", walletAddress)
          .maybeSingle();
        if (!data) throw new Error(`no privy wallet for ${walletAddress}`);
        walletId = (data as WalletRow).privy_wallet_id;
        walletIdByAddress.set(walletAddress, walletId);
      }
      return signWithPrivy(walletId, walletAddress, transactions);
    },
  } as TransactionSigner;
}
