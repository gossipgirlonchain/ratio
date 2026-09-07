/**
 * PrivyWalletProvider (R4): real server wallets keyed to the NUMERIC X
 * user id, behind the exact WalletProvider seam the mock and devnet
 * providers fill. First touch auto-provisions — side authors get wallets
 * at market creation so fees accrue before they ever log in.
 *
 * Wallet ownership map lives in Supabase (wallets table, service-role
 * only). Creation is idempotent two ways: our table lookup first, and a
 * Privy idempotency key derived from the X id second, so a crash between
 * create and insert cannot mint a second wallet for the same person.
 *
 * Signing: Solana tx signatures are ed25519 over the message bytes, so
 * the kit TransactionPartialSigner maps 1:1 onto Privy's signMessage —
 * no round trip through full-transaction serialization.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Address, SignatureBytes, TransactionSigner } from "@solana/kit";

import type { Wallet, WalletProvider } from "./wallets.js";

const PRIVY_API = "https://api.privy.io/v1";

export interface PrivyCreds {
  appId: string;
  appSecret: string;
}

interface WalletRow {
  x_user_id: string;
  privy_wallet_id: string;
  address: string;
}

export class PrivyWalletProvider implements WalletProvider {
  private db: SupabaseClient;
  private byAddress = new Map<string, { walletId: string }>();

  constructor(
    private readonly creds: PrivyCreds,
    supabaseUrl: string,
    supabaseServiceKey: string,
  ) {
    this.db = createClient(supabaseUrl, supabaseServiceKey, { auth: { persistSession: false } });
  }

  private async privy<T>(path: string, body: unknown, idempotencyKey?: string): Promise<T> {
    const res = await fetch(`${PRIVY_API}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.creds.appId}:${this.creds.appSecret}`).toString("base64")}`,
        "privy-app-id": this.creds.appId,
        "content-type": "application/json",
        ...(idempotencyKey ? { "privy-idempotency-key": idempotencyKey } : {}),
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`privy ${path} -> ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
    return (await res.json()) as T;
  }

  async getWallet(xUserId: string): Promise<Wallet> {
    const { data, error } = await this.db
      .from("wallets")
      .select()
      .eq("x_user_id", xUserId)
      .eq("chain", "solana")
      .maybeSingle();
    if (error) throw new Error(`wallets lookup: ${error.message}`);
    if (data) {
      const row = data as WalletRow;
      this.byAddress.set(row.address, { walletId: row.privy_wallet_id });
      return { address: row.address };
    }

    const created = await this.privy<{ id: string; address: string }>(
      "/wallets",
      { chain_type: "solana" },
      `ratio-wallet-${xUserId}`,
    );
    const { error: insertErr } = await this.db.from("wallets").insert({
      x_user_id: xUserId,
      chain: "solana",
      privy_wallet_id: created.id,
      address: created.address,
      created_at_ms: Date.now(),
    });
    // A concurrent provision can win the insert race; re-read and use it.
    if (insertErr) {
      const { data: raced } = await this.db
        .from("wallets")
        .select()
        .eq("x_user_id", xUserId)
        .eq("chain", "solana")
        .maybeSingle();
      if (raced) {
        const row = raced as WalletRow;
        this.byAddress.set(row.address, { walletId: row.privy_wallet_id });
        return { address: row.address };
      }
      throw new Error(`wallets insert: ${insertErr.message}`);
    }
    this.byAddress.set(created.address, { walletId: created.id });
    return { address: created.address };
  }

  /** The chain adapter resolves bettor addresses back to signers here. */
  signerFor(walletAddress: string): TransactionSigner {
    const provider = this;
    return {
      address: walletAddress as Address,
      async signTransactions(transactions) {
        let entry = provider.byAddress.get(walletAddress);
        if (!entry) {
          const { data } = await provider.db
            .from("wallets")
            .select()
            .eq("address", walletAddress)
            .maybeSingle(); // address is globally unique, so no chain filter
          if (!data) throw new Error(`no privy wallet for ${walletAddress}`);
          entry = { walletId: (data as WalletRow).privy_wallet_id };
          provider.byAddress.set(walletAddress, entry);
        }
        const out: Array<Record<string, SignatureBytes>> = [];
        for (const tx of transactions) {
          const r = await provider.privy<{ data: { signature: string; encoding: string } }>(
            `/wallets/${entry.walletId}/rpc`,
            {
              method: "signMessage",
              params: {
                message: Buffer.from(tx.messageBytes as unknown as Uint8Array).toString("base64"),
                encoding: "base64",
              },
            },
          );
          const sig = Uint8Array.from(Buffer.from(r.data.signature, "base64"));
          out.push({ [walletAddress]: sig as unknown as SignatureBytes });
        }
        return out as never;
      },
    } as TransactionSigner;
  }
}
