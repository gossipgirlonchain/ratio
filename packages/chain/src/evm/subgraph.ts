/**
 * The subgraph client. This is where ratio reads the half of itself that
 * cannot be read anywhere else.
 *
 * On chain there are no entry prices and no trade history — the pools drain at
 * migration and Uniswap v4 is a singleton, so "what has side A raised" is not
 * a balance you can query. Every time series in the product (the chart, the
 * trending ranking, the fee and trader boards, a user's positions) is a sum
 * over indexed events or it does not exist.
 *
 * So the agent is a genuine consumer, not a decoration: it reads market state
 * from here to price its odds and to tell a bettor where the money is. If the
 * subgraph is down, those reads fail rather than quietly returning a number
 * from somewhere else.
 */

export interface SubgraphOpts {
  url: string;
  fetchImpl?: typeof fetch;
}

export class SubgraphError extends Error {}

interface GqlResponse<T> {
  data?: T;
  errors?: { message: string }[];
}

export interface SideTotals {
  raisedWei: [bigint, bigint];
  tokens: [bigint, bigint];
  tradeCount: number;
}

export interface TrendingMarket {
  oracle: string;
  marketId: string;
  totalStakedWei: bigint;
  tradeCount: number;
  resolved: boolean;
  settlesAt: number;
}

export interface TradePoint {
  side: 0 | 1;
  bettor: string;
  amountInWei: bigint;
  tokensOut: bigint;
  /** amountIn/tokensOut scaled 1e18. Exists nowhere but here. */
  priceWad: bigint;
  timestamp: number;
}

export interface LeaderRow {
  address: string;
  totalStakedWei: bigint;
  totalPaidOutWei: bigint;
  realisedProfitWei: bigint;
  wins: number;
  losses: number;
}

export class RatioSubgraph {
  private readonly doFetch: typeof fetch;

  constructor(private readonly opts: SubgraphOpts) {
    this.doFetch = opts.fetchImpl ?? fetch;
  }

  private async query<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const res = await this.doFetch(this.opts.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query, variables }),
    });
    if (!res.ok) throw new SubgraphError(`subgraph -> ${res.status}`);
    const body = (await res.json()) as GqlResponse<T>;
    if (body.errors?.length) {
      throw new SubgraphError(body.errors.map((e) => e.message).join("; "));
    }
    if (!body.data) throw new SubgraphError("subgraph returned no data");
    return body.data;
  }

  /**
   * Per-side stake for one market, by oracle address.
   *
   * This is what the odds are computed from. Not a chain read — see the header.
   */
  async sideTotals(oracle: string): Promise<SideTotals> {
    const data = await this.query<{
      market: { entries: { side: number; staked: string; tradeCount: number }[] } | null;
    }>(
      `query SideTotals($id: ID!) {
         market(id: $id) {
           entries { side staked tradeCount }
         }
       }`,
      { id: oracle.toLowerCase() },
    );
    const raised: [bigint, bigint] = [0n, 0n];
    const tokens: [bigint, bigint] = [0n, 0n];
    let tradeCount = 0;
    for (const e of data.market?.entries ?? []) {
      const side = e.side === 0 ? 0 : 1;
      raised[side] = BigInt(e.staked);
      tradeCount += e.tradeCount;
    }
    return { raisedWei: raised, tokens, tradeCount };
  }

  /**
   * Trending, ranked by STAKED VOLUME rather than market count. Tagging is
   * free and counts are inflatable; volume cannot be faked without spending.
   */
  async trending(limit = 20, openOnly = true): Promise<TrendingMarket[]> {
    const data = await this.query<{
      markets: {
        id: string;
        marketId: string;
        totalStaked: string;
        tradeCount: number;
        resolved: boolean;
        settlesAt: string;
      }[];
    }>(
      `query Trending($limit: Int!, $resolved: [Boolean!]) {
         markets(
           first: $limit
           orderBy: totalStaked
           orderDirection: desc
           where: { resolved_in: $resolved }
         ) { id marketId totalStaked tradeCount resolved settlesAt }
       }`,
      { limit, resolved: openOnly ? [false] : [true, false] },
    );
    return data.markets.map((m) => ({
      oracle: m.id,
      marketId: m.marketId,
      totalStakedWei: BigInt(m.totalStaked),
      tradeCount: m.tradeCount,
      resolved: m.resolved,
      settlesAt: Number(m.settlesAt),
    }));
  }

  /**
   * Every trade in a market, oldest first. The market page chart is drawn from
   * this and nothing else — entry prices are unreconstructable otherwise.
   */
  async trades(oracle: string, limit = 1000): Promise<TradePoint[]> {
    const data = await this.query<{
      trades: {
        side: number;
        bettor: string;
        amountIn: string;
        tokensOut: string;
        price: string;
        timestamp: string;
      }[];
    }>(
      `query Trades($id: String!, $limit: Int!) {
         trades(
           first: $limit
           orderBy: timestamp
           orderDirection: asc
           where: { market: $id }
         ) { side bettor amountIn tokensOut price timestamp }
       }`,
      { id: oracle.toLowerCase(), limit },
    );
    return data.trades.map((t) => ({
      side: t.side === 0 ? 0 : 1,
      bettor: t.bettor,
      amountInWei: BigInt(t.amountIn),
      tokensOut: BigInt(t.tokensOut),
      priceWad: BigInt(t.price),
      timestamp: Number(t.timestamp),
    }));
  }

  /**
   * Traders ranked by realised profit. The OTHER board — people good at
   * betting, as opposed to people being bet on, who rank by fees earned.
   * Different populations, never merged.
   */
  async traderLeaderboard(limit = 50): Promise<LeaderRow[]> {
    const data = await this.query<{
      users: {
        id: string;
        totalStaked: string;
        totalPaidOut: string;
        realisedProfit: string;
        wins: number;
        losses: number;
      }[];
    }>(
      `query Traders($limit: Int!) {
         users(first: $limit, orderBy: realisedProfit, orderDirection: desc) {
           id totalStaked totalPaidOut realisedProfit wins losses
         }
       }`,
      { limit },
    );
    return data.users.map((u) => ({
      address: u.id,
      totalStakedWei: BigInt(u.totalStaked),
      totalPaidOutWei: BigInt(u.totalPaidOut),
      realisedProfitWei: BigInt(u.realisedProfit),
      wins: u.wins,
      losses: u.losses,
    }));
  }

  /** A user's open positions, for the profile and the claim surface. */
  async positions(bettor: string): Promise<
    { oracle: string; side: 0 | 1; tokens: bigint; netStakedWei: bigint; claimed: boolean }[]
  > {
    const data = await this.query<{
      positions: {
        market: { id: string };
        side: number;
        tokens: string;
        netStaked: string;
        claimed: boolean;
      }[];
    }>(
      `query Positions($bettor: Bytes!) {
         positions(first: 1000, where: { bettor: $bettor }) {
           market { id } side tokens netStaked claimed
         }
       }`,
      { bettor: bettor.toLowerCase() },
    );
    return data.positions.map((p) => ({
      oracle: p.market.id,
      side: p.side === 0 ? 0 : 1,
      tokens: BigInt(p.tokens),
      netStakedWei: BigInt(p.netStaked),
      claimed: p.claimed,
    }));
  }

  /** Liveness, so a deploy can be checked without guessing. */
  async health(): Promise<{ marketCount: number; tradeCount: number; totalStakedWei: bigint }> {
    const data = await this.query<{
      protocol: { marketCount: number; tradeCount: number; totalStaked: string } | null;
    }>(
      `query Health { protocol(id: "0x726174696f") { marketCount tradeCount totalStaked } }`,
      {},
    );
    const p = data.protocol;
    return {
      marketCount: p?.marketCount ?? 0,
      tradeCount: p?.tradeCount ?? 0,
      totalStakedWei: BigInt(p?.totalStaked ?? "0"),
    };
  }
}
