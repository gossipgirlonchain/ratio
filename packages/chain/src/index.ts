/**
 * On-chain surface, modeled directly on the Doppler prediction-migrator
 * lifecycle proven in cue-wire's devnet e2e (confirmed as ratio's path
 * 2026-07-31 — no CPMM branch):
 *
 *   createMarket: oracle + one XYK curve per side, feeBeneficiaries skimmed
 *                 at swap time on each curve
 *   placeBet:     swap on that side's curve (early/contrarian money gets more
 *                 tokens per USDC — time-priority pricing within a side)
 *   settle:       finalize(winner) -> migrate both entries -> pot
 *                 (finalize GATES migrate; parimutuel pot split at claim)
 *
 * MockMarketChain reproduces those semantics in memory for the sim; the real
 * devnet client ports cue-wire's packages/doppler behind this same interface.
 */

export interface FeeBeneficiary {
  wallet: string;
  shareBps: number; // of the swap fee
}

export interface ChainRefs {
  marketId: string;
}

/**
 * A stake, in whichever unit the person said it in.
 *
 * Both are accepted because both kinds of person show up: "$25" from someone
 * thinking in dollars, "0.01" from someone thinking in ETH. Carrying the unit
 * this far down rather than normalising at the edge means an exact "0.01 ETH"
 * lands as exactly 0.01 ETH — converting to USD and back would round it into
 * something slightly else, which is a bad thing to do to somebody's money.
 *
 * `native` is the chain's own quote asset: ETH on Base, SOL on Solana.
 */
export type Stake = { usd: number } | { native: number };

export interface Odds {
  /** Money-implied probability of side A, from per-side raised quote. */
  impliedA: number;
  raisedUsd: [number, number];
}

export interface MarketChain {
  createMarket(opts: {
    nonce: string;
    feeBeneficiaries: FeeBeneficiary[];
    outcomes: [string, string];
    /**
     * When this market closes, epoch ms. Passed in rather than computed by the
     * chain: the engine stores this value and the contract enforces it, and if
     * each derived its own from its own clock they would differ by however
     * long market creation took — several transactions and a minute or more.
     * The store would then call a market closed while the chain refused to
     * settle it.
     */
    settlesAtMs: number;
  }): Promise<ChainRefs>;
  placeBet(opts: {
    refs: ChainRefs;
    side: 0 | 1;
    stake: Stake;
    bettor: string;
  }): Promise<{ tokensOut: number; signature: string }>;
  /**
   * What a stake is worth in USD. The engine needs it for the min/max policy,
   * which stays denominated in dollars regardless of what the user typed, and
   * the bot needs it to say the amount back to them.
   */
  stakeUsd(stake: Stake): Promise<number>;
  /**
   * Quote source for the UI (§7): NEVER computed client-side from pot
   * totals — the real implementation simulates previewSwapExactIn. Entry
   * is curve-priced, so tokensOut (not dollars) is the unit of payout.
   */
  previewStake(opts: {
    refs: ChainRefs;
    side: 0 | 1;
    stake: Stake;
  }): Promise<{ tokensOut: number; feeUsd: number }>;
  getOdds(refs: ChainRefs): Promise<Odds>;
  /**
   * Spendable balance of a wallet, in USD. On the seam rather than injected
   * into EngineConfig (where it lived until the EVM port): it is a chain
   * read like any other, and a caller holding a MarketChain should not also
   * need an RPC handle to answer "can this person afford the bet".
   */
  balanceUsd(walletAddress: string): Promise<number>;
  /**
   * Quote-denominated funds a wallet holds but cannot spend, because the
   * chain parks them in per-token accounting (Solana: ATA rent). Zero on
   * chains with no such concept. Surfaced to users because otherwise the
   * numbers do not add up and it reads as missing money.
   */
  reservedUsd(walletAddress: string): Promise<number>;
  /** Withdraw/deposit rail: a plain quote-asset transfer between wallets. */
  transferUsd(opts: {
    from: string;
    to: string;
    amountUsd: number;
  }): Promise<{ signature: string }>;
  /** Address shape check for the withdraw form, in the chain's own format. */
  isValidAddress(candidate: string): boolean;
  settle(opts: { refs: ChainRefs; winner: 0 | 1 }): Promise<void>;
  /** Post-settlement payout: claim a bettor's full winning balance into
   * their wallet. null = they hold nothing on the winning side. */
  claimFor(opts: {
    refs: ChainRefs;
    winner: 0 | 1;
    bettor: string;
  }): Promise<{ paidUsd: number } | null>;
}

// ---------------------------------------------------------------------------
// Mock — parimutuel with per-side XYK price discovery, like the real thing
// ---------------------------------------------------------------------------

interface MockSide {
  virtualBase: number;
  virtualQuote: number;
  raisedUsd: number; // net of fee, what migrates to the pot
  tokensOut: number;
}

interface MockMarket {
  sides: [MockSide, MockSide];
  feeBeneficiaries: FeeBeneficiary[];
  feesUsd: number;
  state: "open" | "settled";
  winner?: 0 | 1;
}

export class MockMarketChain implements MarketChain {
  markets = new Map<string, MockMarket>();
  private bets = 0;

  constructor(private readonly swapFeeBps: number) {}

  private newSide(): MockSide {
    return { virtualBase: 1_000, virtualQuote: 1_000, raisedUsd: 0, tokensOut: 0 };
  }

  async createMarket(opts: {
    nonce: string;
    feeBeneficiaries: FeeBeneficiary[];
    outcomes: [string, string];
    settlesAtMs?: number;
  }): Promise<ChainRefs> {
    const totalBps = opts.feeBeneficiaries.reduce((s, b) => s + b.shareBps, 0);
    if (totalBps !== 10_000)
      throw new Error(`feeBeneficiaries shareBps must sum to 10000, got ${totalBps}`);
    this.markets.set(opts.nonce, {
      sides: [this.newSide(), this.newSide()],
      feeBeneficiaries: opts.feeBeneficiaries,
      feesUsd: 0,
      state: "open",
    });
    return { marketId: opts.nonce };
  }

  private market(refs: ChainRefs): MockMarket {
    const m = this.markets.get(refs.marketId);
    if (!m) throw new Error(`no market ${refs.marketId}`);
    return m;
  }

  /** XYK: tokensOut for a net quote-in at the CURRENT curve state. */
  private curveTokensOut(side: MockSide, netUsd: number): number {
    return (
      side.virtualBase - (side.virtualBase * side.virtualQuote) / (side.virtualQuote + netUsd)
    );
  }

  /** Mock world: one native unit is one dollar, so scenarios read plainly. */
  async stakeUsd(stake: Stake): Promise<number> {
    return "usd" in stake ? stake.usd : stake.native;
  }

  async placeBet(opts: {
    refs: ChainRefs;
    side: 0 | 1;
    stake: Stake;
    bettor: string;
  }): Promise<{ tokensOut: number; signature: string }> {
    const amountUsd = await this.stakeUsd(opts.stake);
    const m = this.market(opts.refs);
    if (m.state !== "open") throw new Error("market not open");
    const fee = (amountUsd * this.swapFeeBps) / 10_000;
    const net = amountUsd - fee;
    m.feesUsd += fee;
    const side = m.sides[opts.side];
    const tokensOut = this.curveTokensOut(side, net);
    side.virtualBase -= tokensOut;
    side.virtualQuote += net;
    side.raisedUsd += net;
    side.tokensOut += tokensOut;
    this.bets += 1;
    return { tokensOut, signature: `mock-bet-${this.bets}` };
  }

  /** Mirrors previewSwapExactIn: quote without mutating the curve. */
  async previewStake(opts: {
    refs: ChainRefs;
    side: 0 | 1;
    stake: Stake;
  }): Promise<{ tokensOut: number; feeUsd: number }> {
    const amountUsd = await this.stakeUsd(opts.stake);
    const m = this.market(opts.refs);
    if (m.state !== "open") throw new Error("market not open");
    const feeUsd = (amountUsd * this.swapFeeBps) / 10_000;
    return {
      tokensOut: this.curveTokensOut(m.sides[opts.side], amountUsd - feeUsd),
      feeUsd,
    };
  }

  async getOdds(refs: ChainRefs): Promise<Odds> {
    const m = this.market(refs);
    const [a, b] = [m.sides[0].raisedUsd, m.sides[1].raisedUsd];
    const total = a + b;
    return { impliedA: total === 0 ? 0.5 : a / total, raisedUsd: [a, b] };
  }

  /** Mock world: everyone is solvent unless a scenario says otherwise. */
  balances = new Map<string, number>();
  setBalance(walletAddress: string, usd: number): void {
    this.balances.set(walletAddress, usd);
  }
  async balanceUsd(walletAddress: string): Promise<number> {
    return this.balances.get(walletAddress) ?? Number.POSITIVE_INFINITY;
  }
  /** No per-token account rent in the mock world. */
  async reservedUsd(): Promise<number> {
    return 0;
  }
  transfers: Array<{ from: string; to: string; amountUsd: number }> = [];
  async transferUsd(opts: {
    from: string;
    to: string;
    amountUsd: number;
  }): Promise<{ signature: string }> {
    this.transfers.push(opts);
    return { signature: `mock-transfer-${this.transfers.length}` };
  }
  /** Mock addresses are `wallet:<x id>` — see MockWalletProvider. */
  isValidAddress(candidate: string): boolean {
    return candidate.startsWith("wallet:") && candidate.length > "wallet:".length;
  }

  async settle(opts: { refs: ChainRefs; winner: 0 | 1 }): Promise<void> {
    const m = this.market(opts.refs);
    if (m.state !== "open") throw new Error("market not open");
    // Mirrors on-chain ZeroClaimableSupply: migration throws when nobody
    // holds the winning side. Treasury seeding makes this unreachable;
    // the engine treats it as a held invariant, never a settle path.
    if (m.sides[opts.winner].tokensOut === 0) throw new Error("ZeroClaimableSupply");
    m.state = "settled";
    m.winner = opts.winner;
  }

  /**
   * Claim quote, TOKEN-WEIGHTED like the real chain (§7 correction — the
   * old helper split by dollars): payout = burn / claimableSupply × pot,
   * where claimableSupply = winner tokens actually sold.
   */
  claimQuote(refs: ChainRefs, tokensBurned: number): number {
    const m = this.market(refs);
    if (m.state !== "settled" || m.winner === undefined) throw new Error("not settled");
    const pot = m.sides[0].raisedUsd + m.sides[1].raisedUsd;
    return (tokensBurned / m.sides[m.winner].tokensOut) * pot;
  }
  async claimFor(_opts: {
    refs: ChainRefs;
    winner: 0 | 1;
    bettor: string;
  }): Promise<{ paidUsd: number } | null> {
    // mock world settles by bookkeeping; payout math lives in the sim
    return null;
  }
}
