/**
 * The web's read side of the index.
 *
 * On EVM the money half of ratio cannot be read from chain. Uniswap v4 is a
 * singleton, so "what has side A raised" is not a balance anywhere; the pools
 * drain into the pot at migration; and nothing on chain ever stored what a
 * position cost. Pots, entry prices, the chart, the boards — all of it is a
 * sum over indexed events or it does not exist.
 *
 * So this is not a cache in front of a chain read. It is the only copy.
 *
 * What it deliberately is NOT is a second source of truth for the same
 * numbers: when the index answers, our own bet records are not consulted for
 * money at all. A bet placed straight at the contract, never through our UI,
 * counts exactly the same as one we brokered. When it does not answer, the
 * payload says so (`source: "store"`) rather than quietly serving the lesser
 * number as if it were the same thing.
 */
import "server-only";

import {
  coinbaseEthUsd,
  RatioSubgraph,
  type IndexedMarket,
  type IndexedTrade,
} from "@ratio/chain/evm";

import { supabaseAdmin } from "./supabaseServer";

const WEI_PER_ETH = 1e18;

let client: RatioSubgraph | null | undefined;

/**
 * Configured or not. Two conditions, both required.
 *
 * The URL is the obvious one. The chain switch is the one worth stating: this
 * index describes Base Sepolia, so on a Solana deployment it is not a
 * degraded source, it is a different market's numbers. Our own store is
 * correct there, and reading here anyway would put EVM pots on Solana
 * markets.
 */
export function ratioSubgraph(): RatioSubgraph | null {
  if (client !== undefined) return client;
  const url = process.env.RATIO_SUBGRAPH_URL;
  const isEvm = process.env.RATIO_CHAIN?.toLowerCase() === "evm";
  client =
    url && isEvm
      ? new RatioSubgraph({
          url,
          /**
           * Next patches global fetch with its Data Cache, and a cached
           * index is worse than no index: the app served an hour-old world
           * and reported it as live, with a market that had just settled
           * still showing as never having existed. Live data, every request.
           */
          fetchImpl: (input, init) => fetch(input, { ...init, cache: "no-store" }),
        })
      : null;
  return client;
}

const ethUsdSource = coinbaseEthUsd();

export interface IndexedMoney {
  /** Keyed by side-B tweet id — our store's market id. */
  markets: Map<string, IndexedMarket>;
  tradesByMarket: Map<string, IndexedTrade[]>;
  ethUsd: number;
  /** X handle for a bettor address, when we provisioned the wallet. */
  handleFor: (address: string) => string | undefined;
  usd: (wei: bigint) => number;
}

/**
 * One round trip for the index, one for the wallet handles, one for the ETH
 * price. Returns null when there is no index configured or it cannot be
 * reached — the caller falls back and labels the payload.
 */
export async function indexedMoney(): Promise<IndexedMoney | null> {
  const sg = ratioSubgraph();
  if (!sg) return null;

  let world, ethUsd: number, handles: Map<string, string>;
  try {
    [world, ethUsd, handles] = await Promise.all([
      sg.world(),
      ethUsdSource(),
      walletHandles(),
    ]);
  } catch (err) {
    // Loud, because the fallback is a strictly worse number and the payload
    // is about to say so.
    console.error("subgraph read failed, falling back to store records:", err);
    return null;
  }

  const markets = new Map<string, IndexedMarket>();
  for (const m of world.markets) markets.set(m.marketId, m);

  const tradesByMarket = new Map<string, IndexedTrade[]>();
  for (const t of world.trades) {
    const list = tradesByMarket.get(t.marketId);
    if (list) list.push(t);
    else tradesByMarket.set(t.marketId, [t]);
  }

  return {
    markets,
    tradesByMarket,
    ethUsd,
    handleFor: (addr) => handles.get(addr.toLowerCase()),
    usd: (wei) => (Number(wei) / WEI_PER_ETH) * ethUsd,
  };
}

/**
 * address -> handle, for the wallets we provisioned. An address we never
 * provisioned has no handle and is shown truncated: someone who bet on chain
 * without going through X login is a real bettor, not a hole in the data.
 */
async function walletHandles(): Promise<Map<string, string>> {
  const { data, error } = await supabaseAdmin()
    .from("wallets")
    .select("address, handle")
    .eq("chain", "ethereum");
  if (error) throw new Error(`wallet handles: ${error.message}`);
  const map = new Map<string, string>();
  for (const row of (data ?? []) as { address: string; handle: string | null }[]) {
    if (row.handle) map.set(row.address.toLowerCase(), row.handle);
  }
  return map;
}

/** `0x91aa…98BE` — an address with no X account behind it. */
export function shortAddress(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}
