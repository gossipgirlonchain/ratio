/**
 * DopplerMarketChain — the real MarketChain: RatioMarketClient on devnet
 * behind the same interface the mock implements. The engine cannot tell
 * them apart; that is the whole point of the seam.
 *
 * Notes:
 * - Quote = WSOL on devnet (USDC faucets are flaky); `lamportsPerUsd` maps
 *   the engine's USD amounts onto lamports. Production flips the quote mint
 *   to USDC and this becomes 1e6/$.
 * - PairMarketRefs are kept in an in-process map keyed by the engine's
 *   marketId. The Supabase store serializes them alongside the market row
 *   when it lands (R4); the sim does not restart mid-run.
 */
import { address, type TransactionSigner } from "@solana/kit";

import {
  claimAndUnwrap,
  RatioMarketClient,
  readOdds,
  recoverRefs,
  WSOL_MINT,
  type PairMarketRefs,
} from "@ratio/doppler/pair-market";
import type { Clients } from "@ratio/doppler/tx";

import type { ChainRefs, FeeBeneficiary, MarketChain, Odds } from "./chain.js";

export class DopplerMarketChain implements MarketChain {
  private refsById = new Map<string, PairMarketRefs>();

  constructor(
    private readonly clients: Clients,
    private readonly client: RatioMarketClient,
    private readonly opts: {
      swapFeeBps: number;
      /** Lamports per $1 of stake (WSOL sim; USDC production = 1_000_000n). */
      lamportsPerUsd: bigint;
      /** Bettor addresses resolve to signers here (Privy in production). */
      signerFor: (walletAddress: string) => TransactionSigner;
      /** Refs recovery inputs for markets launched by a previous process:
       * the oracle PDA derives from the operator, outcomes from labels. */
      operatorAddress: string;
      labelsFor: (marketId: string) => Promise<[string, string]>;
    },
  ) {}

  async createMarket(params: {
    nonce: string;
    feeBeneficiaries: FeeBeneficiary[];
    outcomes: [string, string];
  }): Promise<ChainRefs> {
    const refs = await this.client.createMarket({
      nonce: BigInt(params.nonce),
      quoteMint: WSOL_MINT,
      swapFeeBps: this.opts.swapFeeBps,
      feeBeneficiaries: params.feeBeneficiaries.map((b) => ({
        wallet: address(b.wallet),
        shareBps: b.shareBps,
      })),
      outcomes: [
        { label: params.outcomes[0].slice(0, 32), symbol: "RTOA" },
        { label: params.outcomes[1].slice(0, 32), symbol: "RTOB" },
      ],
    });
    this.refsById.set(params.nonce, refs);
    return { marketId: params.nonce };
  }

  /** In-process refs, or RECOVERED from chain: containers restart, markets
   * outlive them. Recovery needs only the nonce, operator, and labels. */
  private async refs(chainRefs: ChainRefs): Promise<PairMarketRefs> {
    const hit = this.refsById.get(chainRefs.marketId);
    if (hit) return hit;
    const labels = await this.opts.labelsFor(chainRefs.marketId);
    const refs = await recoverRefs({
      clients: this.clients,
      operatorAddress: address(this.opts.operatorAddress),
      nonce: BigInt(chainRefs.marketId),
      labels,
    });
    this.refsById.set(chainRefs.marketId, refs);
    console.log(`  chain refs recovered for market ${chainRefs.marketId}`);
    return refs;
  }

  async placeBet(params: {
    refs: ChainRefs;
    side: 0 | 1;
    amountUsd: number;
    bettor: string;
  }): Promise<{ tokensOut: number }> {
    const result = await this.client.placeBet({
      refs: await this.refs(params.refs),
      side: params.side,
      amountIn:
        BigInt(Math.round(params.amountUsd)) * this.opts.lamportsPerUsd,
      bettor: this.opts.signerFor(params.bettor),
      wrapSol: true, // WSOL quote; USDC flips this off
    });
    void result.signature;
    return { tokensOut: 0 }; // token amount lives in the bettor's ATA on-chain
  }

  async previewStake(_params: {
    refs: ChainRefs;
    side: 0 | 1;
    amountUsd: number;
  }): Promise<{ tokensOut: number; feeUsd: number }> {
    // Real path (§7): build previewSwapExactIn for the side's launch and
    // SIMULATE it — never compute a quote from pot totals. Lands with the
    // market-page quote wiring; nothing agent-side calls this yet.
    throw new Error(
      "previewStake: wire previewSwapExactIn simulation before exposing quotes",
    );
  }

  async getOdds(chainRefs: ChainRefs): Promise<Odds> {
    const view = await readOdds(this.clients, await this.refs(chainRefs));
    const toUsd = (raised: bigint) =>
      Number(raised) / Number(this.opts.lamportsPerUsd);
    return {
      impliedA: view.implied0,
      raisedUsd: [toUsd(view.raised[0]), toUsd(view.raised[1])],
    };
  }

  async settle(params: { refs: ChainRefs; winner: 0 | 1 }): Promise<void> {
    await this.client.resolveAndMigrate({
      refs: await this.refs(params.refs),
      winner: params.winner,
    });
  }

  async claimFor(params: {
    refs: ChainRefs;
    winner: 0 | 1;
    bettor: string;
  }): Promise<{ paidUsd: number } | null> {
    const result = await claimAndUnwrap({
      clients: this.clients,
      refs: await this.refs(params.refs),
      winner: params.winner,
      claimer: this.opts.signerFor(params.bettor),
    });
    if (!result) return null;
    return { paidUsd: Number(result.paidLamports) / Number(this.opts.lamportsPerUsd) };
  }

}
