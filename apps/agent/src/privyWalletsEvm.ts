/**
 * PrivyEvmWalletProvider: EVM server wallets keyed to the numeric X user id,
 * behind the same WalletProvider seam the mock and Solana providers fill.
 *
 * NOT a migration. The existing Solana wallets stay exactly where they are and
 * are never touched. These are new `chain_type: "ethereum"` wallets under a
 * separate idempotency namespace, so one person ends up with one Solana wallet
 * and one EVM wallet rather than a mapping between them. Migration is where the
 * collide-two-users-into-one-wallet bug lives, and the Solana wallets hold
 * devnet funds and nothing of value, so there is nothing to migrate.
 *
 * The wallets table gains a `chain` column for the same reason: `x_user_id`
 * alone is no longer unique once a person can have one wallet per chain.
 *
 * Signing: Privy holds the key and exposes `eth_signTransaction`, so this is a
 * viem custom Account that delegates every signature over the wire. The agent
 * never sees a private key, which is the same property the Solana path had.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { toAccount } from "viem/accounts";
import {
  hashMessage,
  hashTypedData,
  type Account,
  type Address,
  type Hex,
} from "viem";

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
  chain: string;
}

export class PrivyEvmWalletProvider implements WalletProvider {
  private db: SupabaseClient;
  private byAddress = new Map<string, string>();

  constructor(
    private readonly creds: PrivyCreds,
    supabaseUrl: string,
    supabaseServiceKey: string,
  ) {
    this.db = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false },
    });
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
      .eq("chain", "ethereum")
      .maybeSingle();
    if (error) throw new Error(`wallets lookup: ${error.message}`);
    if (data) {
      const row = data as WalletRow;
      this.byAddress.set(row.address.toLowerCase(), row.privy_wallet_id);
      return { address: row.address };
    }

    // Distinct namespace from the Solana key (`ratio-wallet-`), so the same
    // person provisions a second wallet rather than colliding with their first.
    const created = await this.privy<{ id: string; address: string }>(
      "/wallets",
      { chain_type: "ethereum" },
      `ratio-evm-wallet-${xUserId}`,
    );

    const up = await this.db
      .from("wallets")
      .upsert(
        {
          x_user_id: xUserId,
          chain: "ethereum",
          privy_wallet_id: created.id,
          address: created.address,
          created_at_ms: Date.now(),
        },
        { onConflict: "x_user_id,chain", ignoreDuplicates: false },
      )
      .select()
      .maybeSingle();
    if (up.error) throw new Error(`wallets upsert: ${up.error.message}`);

    this.byAddress.set(created.address.toLowerCase(), created.id);
    return { address: created.address };
  }

  private async walletId(address: string): Promise<string> {
    const hit = this.byAddress.get(address.toLowerCase());
    if (hit) return hit;
    const { data } = await this.db
      .from("wallets")
      .select()
      .eq("address", address)
      .eq("chain", "ethereum")
      .maybeSingle();
    if (!data) throw new Error(`no privy evm wallet for ${address}`);
    const id = (data as WalletRow).privy_wallet_id;
    this.byAddress.set(address.toLowerCase(), id);
    return id;
  }

  private async rpc(address: string, method: string, params: unknown): Promise<Record<string, string>> {
    const id = await this.walletId(address);
    const r = await this.privy<{ data: Record<string, string> }>(`/wallets/${id}/rpc`, {
      method,
      params,
    });
    return r.data;
  }

  /**
   * A viem Account whose signatures come from Privy. EvmMarketChain resolves
   * bettor and operator addresses through this.
   */
  accountFor(address: string): Account {
    const self = this;
    return toAccount({
      address: address as Address,

      async signMessage({ message }) {
        // Privy signs the EIP-191 digest; viem hands us the raw message.
        const { signature } = await self.rpc(address, "secp256k1_sign", {
          hash: hashMessage(message),
        });
        return signature as Hex;
      },

      async signTransaction(transaction, args) {
        const serializer = args?.serializer;
        // Privy returns a fully signed, serialized transaction, which is
        // exactly what viem wants back — no re-serialization on our side.
        const { signed_transaction } = await self.rpc(address, "eth_signTransaction", {
          transaction: {
            ...transaction,
            // Privy's JSON wants hex strings, not bigints.
            ...(transaction.value !== undefined ? { value: toHex(transaction.value) } : {}),
            ...(transaction.gas !== undefined ? { gas: toHex(transaction.gas) } : {}),
            ...(transaction.nonce !== undefined ? { nonce: toHex(BigInt(transaction.nonce)) } : {}),
            ...(transaction.maxFeePerGas !== undefined
              ? { maxFeePerGas: toHex(transaction.maxFeePerGas) }
              : {}),
            ...(transaction.maxPriorityFeePerGas !== undefined
              ? { maxPriorityFeePerGas: toHex(transaction.maxPriorityFeePerGas) }
              : {}),
            chainId: transaction.chainId,
          },
        });
        void serializer;
        return signed_transaction as Hex;
      },

      async signTypedData(typedData) {
        const { signature } = await self.rpc(address, "secp256k1_sign", {
          hash: hashTypedData(typedData as never),
        });
        return signature as Hex;
      },
    });
  }
}

const toHex = (v: bigint): Hex => `0x${v.toString(16)}`;
