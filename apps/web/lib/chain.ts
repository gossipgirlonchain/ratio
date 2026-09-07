/**
 * The web's MarketChain. One instance per server process, behind the same
 * seam the agent trades through.
 *
 * Until now apps/web had no MarketChain at all — betServer built swaps
 * against RatioMarketClient directly and walletServer hand-rolled balance
 * reads and transfers with @solana/kit. Two parallel chain stacks, one
 * abstraction covering half the codebase. This is the other half.
 *
 * Roles this process does and does not hold:
 *
 *  - It SIGNS as bettors, via their Privy server wallets, and as the
 *    treasury when sponsoring rent. Both resolve through signerFor.
 *  - It is NOT the operator. Only the agent opens and settles markets, and
 *    only the agent holds that key. `operatorAddress` is public information
 *    (it signs every market on chain) and is needed to derive oracle PDAs
 *    when recovering a market's refs; the operator SIGNER is a stub that
 *    throws, so a stray createMarket or settle from a web request fails
 *    loudly instead of quietly doing nothing.
 */
import "server-only";

import { MARKET_DURATION_MS, QUOTE_UNITS_PER_USD_SOLANA, SWAP_FEE_BPS } from "@ratio/config";
import type { MarketChain } from "@ratio/chain";
import { DopplerMarketChain } from "@ratio/chain/solana";
import { BASE_SEPOLIA, BASE_SEPOLIA_RPC, coinbaseEthUsd, EvmMarketChain } from "@ratio/chain/evm";
import { RatioMarketClient } from "@ratio/doppler/pair-market";
import { createClients, type Clients } from "@ratio/doppler/tx";
import { address, type Address, type TransactionSigner } from "@solana/kit";

import { supabaseAdmin } from "./supabaseServer";
import { privyEvmAccount, privySignerByAddress } from "./walletServer";

/** The agent hot wallet that creates markets — oracle PDAs derive from it.
 * Public info (it signs every market on-chain), env-overridable. */
const OPERATOR_ADDRESS =
  process.env.RATIO_OPERATOR_ADDRESS ?? "H7VpbRU72x1X8z4kv18YMzSmzcxuTSqCbBiRS3NaDmQV";

/** The operator key lives in the agent, never here. See the note above. */
function operatorStub(): TransactionSigner {
  return {
    address: address(OPERATOR_ADDRESS) as Address,
    async signTransactions() {
      throw new Error(
        "web holds no operator key: markets are opened and settled by the agent only",
      );
    },
  } as TransactionSigner;
}

let clients: Clients | null = null;
const getClients = () => (clients ??= createClients());

let chainPromise: Promise<MarketChain> | null = null;

/** Same switch the agent reads, so both surfaces trade on one chain. */
const chainKind = () =>
  process.env.RATIO_CHAIN?.toLowerCase() === "evm" ? "evm" : "solana";

async function build(): Promise<MarketChain> {
  return chainKind() === "evm" ? buildEvm() : buildSolana();
}

/**
 * The web signs as BETTORS, never as the operator — it opens no markets and
 * declares no winners. So there is no operator key here and the operator
 * address is only needed to derive the oracle factory's view of a market.
 */
async function buildEvm(): Promise<MarketChain> {
  const db = supabaseAdmin();
  return new EvmMarketChain({
    rpcUrl: process.env.BASE_SEPOLIA_RPC_URL ?? BASE_SEPOLIA_RPC,
    addresses: BASE_SEPOLIA,
    // A stub: the web must never open or settle a market, so this throws
    // loudly rather than silently doing nothing if something tries.
    operator: {
      address: (process.env.RATIO_EVM_OPERATOR ??
        "0x1f976A12eb83bb7b8d15d3DD34A2Bf3197a2eee2") as `0x${string}`,
      type: "local",
      async signMessage() {
        throw new Error("web holds no operator key: markets are opened and settled by the agent");
      },
      async signTransaction() {
        throw new Error("web holds no operator key: markets are opened and settled by the agent");
      },
      async signTypedData() {
        throw new Error("web holds no operator key: markets are opened and settled by the agent");
      },
    } as never,
    signerFor: (addr) => privyEvmAccount(addr),
    ethUsd: coinbaseEthUsd(),
    marketDurationMs: MARKET_DURATION_MS,
    raisedWeiFor: async (marketId) => {
      const { data } = await db
        .from("bets")
        .select("side, direction, amount_usd")
        .eq("market_id", marketId);
      const usd: [number, number] = [0, 0];
      for (const b of (data ?? []) as { side: number; direction: string; amount_usd: number }[]) {
        usd[b.side as 0 | 1] += (b.direction === "buy" ? 1 : -1) * Number(b.amount_usd);
      }
      const rate = await coinbaseEthUsd()();
      const toWei = (u: number) => BigInt(Math.round((u / rate) * 1e18));
      return [toWei(usd[0]), toWei(usd[1])];
    },
  });
}

async function buildSolana(): Promise<MarketChain> {
  const db = supabaseAdmin();
  const treasury = await db
    .from("wallets")
    .select()
    .eq("x_user_id", "ratio:treasury")
    .maybeSingle();

  const marketClient = await RatioMarketClient.create({
    clients: getClients(),
    operator: operatorStub(),
  });

  return new DopplerMarketChain(getClients(), marketClient, {
    swapFeeBps: SWAP_FEE_BPS,
    lamportsPerUsd: QUOTE_UNITS_PER_USD_SOLANA,
    signerFor: privySignerByAddress,
    operatorAddress: OPERATOR_ADDRESS,
    // Treasury sponsors tx fees and ATA rent, never the stake itself. The
    // chain checks its balance per bet and degrades to bettor-pays when it
    // is broke, so passing the address unconditionally is safe.
    sponsorAddress: (treasury.data?.address as string | undefined) ?? undefined,
    labelsFor: async (marketId) => {
      const { data } = await db
        .from("markets")
        .select("author_a_handle, author_b_handle")
        .eq("id", marketId)
        .maybeSingle();
      if (!data) throw new Error(`labelsFor: no market ${marketId} on record`);
      return [`A @${data.author_a_handle}`, `B @${data.author_b_handle}`];
    },
  });
}

/** Lazy singleton: the deployment derivation and treasury lookup happen once. */
export function marketChain(): Promise<MarketChain> {
  return (chainPromise ??= build());
}
