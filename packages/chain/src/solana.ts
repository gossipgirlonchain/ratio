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
import { getTransferSolInstruction } from "@solana-program/system";
import { address, lamports, type TransactionSigner } from "@solana/kit";

import {
  claimAndUnwrap,
  RatioMarketClient,
  readOdds,
  recoverRefs,
  WSOL_MINT,
  type PairMarketRefs,
} from "@ratio/doppler/pair-market";
import { sendInstructions, type Clients } from "@ratio/doppler/tx";

import type { ChainRefs, FeeBeneficiary, MarketChain, Odds } from "./index.js";

const TOKEN_PROGRAM = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

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
      /** Treasury that sponsors tx fees + ATA rent on stakes (never the
       * stake itself). Unset or broke: the bettor pays, bet still lands. */
      sponsorAddress?: string;
    },
  ) {}

  /** Sponsor signer when the treasury can afford it, else undefined. */
  private async sponsor(): Promise<TransactionSigner | undefined> {
    const addr = this.opts.sponsorAddress;
    if (!addr) return undefined;
    try {
      const { value } = await this.clients.rpc.getBalance(address(addr)).send();
      // needs headroom for 2 ATAs + fee; below that, degrade gracefully
      if (value < 6_000_000n) {
        console.error(`  sponsor wallet low (${Number(value) / 1e9} SOL) — bettor pays own rent`);
        return undefined;
      }
      return this.opts.signerFor(addr);
    } catch {
      return undefined;
    }
  }

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
      rentPayer: await this.sponsor(),
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

  async balanceUsd(walletAddress: string): Promise<number> {
    const { value } = await this.clients.rpc.getBalance(address(walletAddress)).send();
    return Number(value) / Number(this.opts.lamportsPerUsd);
  }

  /**
   * Lamports parked as rent in the wallet's token accounts (outcome tokens,
   * WSOL). At the sim rate rent looks big in USD — showing it is the
   * difference between "the numbers add up" and "where did $8 go".
   */
  async reservedUsd(walletAddress: string): Promise<number> {
    const { value } = await this.clients.rpc
      .getTokenAccountsByOwner(
        address(walletAddress),
        { programId: TOKEN_PROGRAM },
        { encoding: "jsonParsed" },
      )
      .send();
    let parked = 0n;
    for (const acc of value) parked += BigInt(acc.account.lamports);
    return Number(parked) / Number(this.opts.lamportsPerUsd);
  }

  async transferUsd(opts: {
    from: string;
    to: string;
    amountUsd: number;
  }): Promise<{ signature: string }> {
    const signer = this.opts.signerFor(opts.from);
    const signature = await sendInstructions({
      clients: this.clients,
      payer: signer,
      label: `transfer $${opts.amountUsd} to ${opts.to}`,
      instructions: [
        getTransferSolInstruction({
          source: signer,
          destination: address(opts.to),
          amount: lamports(
            BigInt(Math.round(opts.amountUsd * Number(this.opts.lamportsPerUsd))),
          ),
        }),
      ],
    });
    return { signature };
  }

  /** base58, 32-44 chars — the Solana address shape. */
  isValidAddress(candidate: string): boolean {
    return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(candidate);
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
