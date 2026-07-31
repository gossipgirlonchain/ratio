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
 *   void:         never finalize — curves stay open, bettors sell back out
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
  }): Promise<ChainRefs>;
  placeBet(opts: {
    refs: ChainRefs;
    side: 0 | 1;
    amountUsd: number;
    bettor: string;
  }): Promise<{ tokensOut: number }>;
  getOdds(refs: ChainRefs): Promise<Odds>;
  settle(opts: { refs: ChainRefs; winner: 0 | 1 }): Promise<void>;
  void(refs: ChainRefs): Promise<void>;
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
  state: "open" | "settled" | "voided";
  winner?: 0 | 1;
}

export class MockMarketChain implements MarketChain {
  markets = new Map<string, MockMarket>();

  constructor(private readonly swapFeeBps: number) {}

  private newSide(): MockSide {
    return { virtualBase: 1_000, virtualQuote: 1_000, raisedUsd: 0, tokensOut: 0 };
  }

  async createMarket(opts: {
    nonce: string;
    feeBeneficiaries: FeeBeneficiary[];
    outcomes: [string, string];
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

  async placeBet(opts: {
    refs: ChainRefs;
    side: 0 | 1;
    amountUsd: number;
    bettor: string;
  }): Promise<{ tokensOut: number }> {
    const m = this.market(opts.refs);
    if (m.state !== "open") throw new Error("market not open");
    const fee = (opts.amountUsd * this.swapFeeBps) / 10_000;
    const net = opts.amountUsd - fee;
    m.feesUsd += fee;
    const side = m.sides[opts.side];
    // XYK: tokensOut = base reserve moved by the quote-in
    const tokensOut =
      side.virtualBase - (side.virtualBase * side.virtualQuote) / (side.virtualQuote + net);
    side.virtualBase -= tokensOut;
    side.virtualQuote += net;
    side.raisedUsd += net;
    side.tokensOut += tokensOut;
    return { tokensOut };
  }

  async getOdds(refs: ChainRefs): Promise<Odds> {
    const m = this.market(refs);
    const [a, b] = [m.sides[0].raisedUsd, m.sides[1].raisedUsd];
    const total = a + b;
    return { impliedA: total === 0 ? 0.5 : a / total, raisedUsd: [a, b] };
  }

  async settle(opts: { refs: ChainRefs; winner: 0 | 1 }): Promise<void> {
    const m = this.market(opts.refs);
    if (m.state !== "open") throw new Error("market not open");
    // Mirrors on-chain ZeroClaimableSupply: migration throws when nobody
    // holds the winning side. The engine must guard and void instead.
    if (m.sides[opts.winner].tokensOut === 0) throw new Error("ZeroClaimableSupply");
    m.state = "settled";
    m.winner = opts.winner;
  }

  async void(refs: ChainRefs): Promise<void> {
    const m = this.market(refs);
    m.state = "voided"; // never finalized; curves allow sells, bettors exit
  }

  /** Sim helper: winner's parimutuel payout multiple (pot / winning pool). */
  payoutMultiple(refs: ChainRefs): number {
    const m = this.market(refs);
    if (m.state !== "settled" || m.winner === undefined) throw new Error("not settled");
    const pot = m.sides[0].raisedUsd + m.sides[1].raisedUsd;
    return pot / m.sides[m.winner].raisedUsd;
  }
}
