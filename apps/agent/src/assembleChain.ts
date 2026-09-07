/**
 * Which chain the agent trades on, and everything that differs because of it.
 *
 * RATIO_CHAIN=evm is Base Sepolia; anything else is Solana devnet. Both return
 * the same two things — a MarketChain and a WalletProvider — because that is
 * the whole point of the seam: main.ts assembles one machine and the engine
 * never learns which chain it is on.
 *
 * Solana stays. It is not deprecated by this and it is not deleted.
 */
import { QUOTE_UNITS_PER_USD_SOLANA, SWAP_FEE_BPS, MARKET_DURATION_MS } from "@ratio/config";
import type { MarketChain } from "@ratio/chain";
import { DopplerMarketChain } from "@ratio/chain/solana";
import { EvmMarketChain, BASE_SEPOLIA, BASE_SEPOLIA_RPC, coinbaseEthUsd } from "@ratio/chain/evm";
import { RatioMarketClient } from "@ratio/doppler/pair-market";
import { createClients } from "@ratio/doppler/tx";
import { createKeyPairSignerFromBytes } from "@solana/kit";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";

import { PrivyWalletProvider } from "./privyWallets.js";
import { PrivyEvmWalletProvider } from "./privyWalletsEvm.js";
import type { Store } from "./store.js";
import type { WalletProvider } from "./wallets.js";

export interface Assembled {
  chain: MarketChain;
  wallets: WalletProvider;
  /** Fee-slot address for Doppler's own slice. The airlock owner on EVM. */
  dopplerWallet: string;
  /** Treasury: seeds both sides at creation. */
  protocolWallet: string;
  describe: string;
}

export function chainKind(): "evm" | "solana" {
  return process.env.RATIO_CHAIN?.toLowerCase() === "evm" ? "evm" : "solana";
}

export async function assembleChain(opts: {
  store: Store;
  supabaseUrl: string;
  supabaseServiceKey: string;
  privyAppId: string;
  privyAppSecret: string;
}): Promise<Assembled> {
  return chainKind() === "evm" ? assembleEvm(opts) : assembleSolana(opts);
}

// ---------------------------------------------------------------------------

async function assembleEvm(opts: {
  store: Store;
  supabaseUrl: string;
  supabaseServiceKey: string;
  privyAppId: string;
  privyAppSecret: string;
}): Promise<Assembled> {
  const pk = process.env.BASE_SEPOLIA_PRIVATE_KEY;
  if (!pk) throw new Error("RATIO_CHAIN=evm but BASE_SEPOLIA_PRIVATE_KEY missing");
  const operator = privateKeyToAccount(pk as Hex);

  const wallets = new PrivyEvmWalletProvider(
    { appId: opts.privyAppId, appSecret: opts.privyAppSecret },
    opts.supabaseUrl,
    opts.supabaseServiceKey,
  );

  const chain = new EvmMarketChain({
    rpcUrl: process.env.BASE_SEPOLIA_RPC_URL ?? BASE_SEPOLIA_RPC,
    addresses: BASE_SEPOLIA,
    operator,
    signerFor: (addr) =>
      addr.toLowerCase() === operator.address.toLowerCase()
        ? operator
        : wallets.accountFor(addr),
    ethUsd: coinbaseEthUsd(),
    marketDurationMs: MARKET_DURATION_MS,
    /**
     * Per-side stake, until the subgraph lands.
     *
     * v4 is a singleton, so this is not a chain read (see EvmMarketChain's
     * header). Backed by our own trade records in the meantime, which is exact
     * for the number that actually matters: the odds are a RATIO, and both
     * sides convert through the same rate, so the ratio is precise even though
     * the absolute wei figure inherits whatever the rate was at bet time.
     */
    raisedWeiFor: async (marketId) => {
      const bets = await opts.store.listBets(marketId);
      const usd: [number, number] = [0, 0];
      for (const b of bets) {
        const sign = b.direction === "buy" ? 1 : -1;
        usd[b.side] += sign * b.amountUsd;
      }
      const rate = await coinbaseEthUsd()();
      const toWei = (u: number) => BigInt(Math.round((u / rate) * 1e18));
      return [toWei(usd[0]), toWei(usd[1])];
    },
  });

  // Doppler's fee slice must pay to the airlock owner, which is a protocol
  // fact rather than a config choice — read it rather than trust an env var.
  const dopplerWallet = await chain.airlockOwner();
  const protocolWallet = (await wallets.getWallet("ratio:treasury")).address;

  return {
    chain,
    wallets,
    dopplerWallet,
    protocolWallet,
    describe: `Base Sepolia, operator ${operator.address}`,
  };
}

async function assembleSolana(opts: {
  store: Store;
  supabaseUrl: string;
  supabaseServiceKey: string;
  privyAppId: string;
  privyAppSecret: string;
}): Promise<Assembled> {
  const operatorBytes = process.env.OPERATOR_KEYPAIR;
  if (!operatorBytes) throw new Error("armed but OPERATOR_KEYPAIR missing");
  const clients = createClients();
  const operator = await createKeyPairSignerFromBytes(
    new Uint8Array(JSON.parse(operatorBytes)),
  );
  const { value: balance } = await clients.rpc.getBalance(operator.address).send();
  if (Number(balance) < 200_000_000) {
    console.error("WARNING: operator under 0.2 SOL — launches will start failing soon");
  }

  const wallets = new PrivyWalletProvider(
    { appId: opts.privyAppId, appSecret: opts.privyAppSecret },
    opts.supabaseUrl,
    opts.supabaseServiceKey,
  );
  const marketClient = await RatioMarketClient.create({ clients, operator });
  const chain = new DopplerMarketChain(clients, marketClient, {
    swapFeeBps: SWAP_FEE_BPS,
    lamportsPerUsd: QUOTE_UNITS_PER_USD_SOLANA,
    signerFor: (addr) => (addr === operator.address ? operator : wallets.signerFor(addr)),
    operatorAddress: operator.address,
    sponsorAddress: (await wallets.getWallet("ratio:treasury")).address,
    labelsFor: async (marketId) => {
      const record = await opts.store.getMarketByTweet(marketId);
      if (!record) throw new Error(`labelsFor: no market ${marketId} on record`);
      return [`A @${record.authorAHandle}`, `B @${record.authorBHandle}`];
    },
  });

  return {
    chain,
    wallets,
    // On Solana the Doppler slice is just a wallet we control; there is no
    // protocol-owner requirement, which is why this needs a fallback and the
    // EVM path does not.
    dopplerWallet:
      process.env.DOPPLER_FEE_WALLET ?? (await wallets.getWallet("ratio:doppler-fee")).address,
    protocolWallet: operator.address, // operator doubles as treasury on devnet
    describe: `Solana devnet, operator ${operator.address}, ${Number(balance) / 1e9} SOL`,
  };
}
