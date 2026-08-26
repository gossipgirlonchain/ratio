/**
 * RatioMarketClient — a two-tweet parimutuel market on doppler-sol.
 *
 * Ported from cue-wire's CuePollMarketClient (proven on devnet 2026-07-16);
 * the market shape is identical, only the oracle input changed: the X poll
 * was the oracle there, absolute like counts are the oracle here. Our
 * resolver service is only the messenger that relays the counts on-chain.
 *
 * Model:
 *   - one trustedOracle per market (nonce = side B's tweet id)
 *   - one XYK bonding curve per side; stakes are swaps on your side's curve
 *   - fees: swapFeeBps skimmed at swap time, split on-chain via
 *     feeBeneficiaries — FIVE slots, the confirmed maximum (Solana tx size):
 *     doppler / ratio treasury / tagger / side A author / side B author.
 *     Weights are IMMUTABLE once the curves launch.
 *   - lifecycle: trade → finalize(winningMint) → migrate entries (burn
 *     unsold, fill potVault) → winners claim pro-rata pot share
 *   - finalize GATES migrate (migrate_entry throws OracleNotFinalized first)
 *   - live odds = per-side quote-vault balances (pot shares — a parimutuel
 *     market has no continuous curve price; every display derives from pot)
 *   - void = never finalize; curves allow sells, bettors exit on the curve
 */
import { SYSTEM_PROGRAM_ADDRESS } from "@solana-program/system";
import { TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { SYSVAR_RENT_ADDRESS } from "@solana/sysvars";
import {
  AccountRole,
  generateKeyPairSigner,
  type Address,
  type Instruction,
  type TransactionSigner,
} from "@solana/kit";

import {
  DOPPLER_SOLANA_DEVNET_PROGRAM_ADDRESSES,
  curveSwapExactIn,
  deriveSolanaCpmmDeployment,
  initializer,
  predictionMigrator,
  trustedOracle,
  type SolanaCpmmDeployment,
} from "@whetstone-research/doppler-sdk/solana";

import {
  findAssociatedTokenPda,
  getCloseAccountInstruction,
  getSyncNativeInstruction,
} from "@solana-program/token";
import { getTransferSolInstruction } from "@solana-program/system";

import {
  sendInitializeLaunchWithLookupTable,
  sendInstructions,
  withRetry429,
  type Clients,
} from "./tx.js";

import { address } from "@solana/kit";

/** Quote mints. */
export const WSOL_MINT = address(
  "So11111111111111111111111111111111111111112",
);
export const DEVNET_USDC_MINT = address(
  "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FeeBeneficiary {
  wallet: Address;
  shareBps: number; // of the fee, must sum to 10_000 across beneficiaries
}

/** Doppler-confirmed hard cap (Solana tx size). All five slots are used. */
export const MAX_FEE_BENEFICIARIES = 5;

export interface PairMarketParams {
  /** Stable id for the market — side B's tweet id (numeric) in production. */
  nonce: bigint;
  /** Exactly two sides: A (the original) and B (the reply/QT). */
  outcomes: [OutcomeParams, OutcomeParams];
  quoteMint: Address;
  swapFeeBps: number; // config SWAP_FEE_BPS = 125
  feeBeneficiaries: FeeBeneficiary[]; // all five parties, immutable after launch
  /** Opening odds lever: virtual quote per side (equal = 50/50). */
  curveVirtualQuote?: bigint;
  baseDecimals?: number;
  baseTotalSupply?: bigint;
}

export interface OutcomeParams {
  label: string; // e.g. "A @handle"
  symbol: string; // token symbol, e.g. "RTOA"
  metadataUri?: string;
}

export interface OutcomeRefs {
  label: string;
  entryId: Uint8Array;
  launch: Address;
  launchAuthority: Address;
  config: Address;
  baseMint: Address;
  baseVault: Address;
  quoteVault: Address;
  launchFeeState: Address;
  entryAddress: Address;
  entryByMint: Address;
}

export interface PairMarketRefs {
  nonce: bigint;
  quoteMint: Address;
  oracleState: Address;
  market: Address;
  potVault: Address;
  marketAuthority: Address;
  outcomes: [OutcomeRefs, OutcomeRefs];
}

export interface OddsView {
  raised: [bigint, bigint];
  /** Implied probability of side A, parimutuel pot-share view. 0.5 when empty. */
  implied0: number;
}

/**
 * Read-only odds — usable without a signer (web server components read this
 * directly). Live raise = per-side quote-vault balances; vaults drain at
 * migration, so settled markets must use their stored snapshot instead.
 */
export async function readOdds(
  clients: Clients,
  refs: PairMarketRefs,
): Promise<OddsView> {
  const [a, b] = (await Promise.all(
    refs.outcomes.map(async (o) =>
      withRetry429(
        async () =>
          BigInt(
            (
              await clients.rpc
                .getTokenAccountBalance(o.quoteVault, {
                  commitment: "confirmed",
                })
                .send()
            ).value.amount,
          ),
        "readOdds",
      ),
    ),
  )) as [bigint, bigint];
  const total = a + b;
  return {
    raised: [a, b],
    implied0: total === 0n ? 0.5 : Number(a) / Number(total),
  };
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class RatioMarketClient {
  private constructor(
    private readonly clients: Clients,
    private readonly deployment: SolanaCpmmDeployment,
    /** Signs oracle create/finalize and pays for market infra (agent hot wallet). */
    private readonly operator: TransactionSigner,
  ) {}

  static async create(opts: {
    clients: Clients;
    operator: TransactionSigner;
    deployment?: SolanaCpmmDeployment;
  }): Promise<RatioMarketClient> {
    const deployment =
      opts.deployment ??
      (await deriveSolanaCpmmDeployment(DOPPLER_SOLANA_DEVNET_PROGRAM_ADDRESSES));
    return new RatioMarketClient(opts.clients, deployment, opts.operator);
  }

  /** Oracle + one launch per side. Returns every address the app needs. */
  async createMarket(params: PairMarketParams): Promise<PairMarketRefs> {
    console.log("    pairMarket: createMarket start");
    const { clients, deployment, operator } = this;
    if (params.feeBeneficiaries.length > MAX_FEE_BENEFICIARIES)
      throw new Error(
        `feeBeneficiaries: max ${MAX_FEE_BENEFICIARIES}, got ${params.feeBeneficiaries.length}`,
      );
    const baseDecimals = params.baseDecimals ?? 6;
    const baseTotalSupply =
      params.baseTotalSupply ?? 1_000_000_000n * 10n ** BigInt(baseDecimals);
    const curveVirtualQuote = params.curveVirtualQuote ?? 500_000_000n;

    const [oracleState] = await trustedOracle.getOracleStateAddress(
      operator.address,
      params.nonce,
    );
    // RESUMABLE: a prior failed launch may have initialized this oracle
    // already (nonce = tweet id, deterministic PDA). Retrying must skip
    // the step, not collide with its own debris.
    const existingOracle = await clients.rpc
      .getAccountInfo(oracleState, { encoding: "base64" })
      .send();
    if (existingOracle.value) {
      console.log("    pairMarket: oracle exists, resuming launch");
    } else {
      await sendInstructions({
        clients,
        payer: operator,
        label: "initialize_oracle",
        instructions: [
          trustedOracle.getInitializeOracleInstruction({
            oracleAuthority: operator,
            oracleState,
            nonce: params.nonce,
            quoteMint: params.quoteMint,
          }),
        ],
      });
    }

    const [market] = await predictionMigrator.getPredictionMarketAddress(
      oracleState,
      params.quoteMint,
    );
    const [potVault] =
      await predictionMigrator.getPredictionPotVaultAddress(market);
    const [marketAuthority] =
      await predictionMigrator.getPredictionMarketAuthorityAddress(market);

    const outcomes: OutcomeRefs[] = [];
    for (const outcome of params.outcomes) {
      // Pace launches — public devnet RPC rate-limits bursts.
      if (outcomes.length > 0) await new Promise((r) => setTimeout(r, 2000));
      const entryId = new Uint8Array(32);
      entryId.set(new TextEncoder().encode(outcome.label).slice(0, 32));

      const baseMint = await generateKeyPairSigner();
      const baseVault = await generateKeyPairSigner();
      const quoteVault = await generateKeyPairSigner();
      const metadata = {
        metadataName: `ratio: ${outcome.label}`.slice(0, 32),
        metadataSymbol: outcome.symbol.slice(0, 10),
        metadataUri:
          outcome.metadataUri ??
          `https://ratio.wtf/meta/${outcome.symbol.toLowerCase()}.json`,
      };
      const addresses = await initializer.deriveCreateLaunchAddresses({
        deployment,
        namespace: oracleState,
        launchId: entryId,
        baseMint,
        metadata,
      });
      const [entryAddress] = await predictionMigrator.getPredictionEntryAddress(
        market,
        entryId,
      );
      const [entryByMint] =
        await predictionMigrator.getPredictionEntryByMintAddress(
          market,
          baseMint.address,
        );
      const predictionRemainingAccounts = [
        oracleState,
        market,
        potVault,
        marketAuthority,
        entryAddress,
        entryByMint,
      ];

      const ix = await initializer.createInitializeLaunchInstruction(
        {
          config: addresses.config,
          launch: addresses.launch,
          launchAuthority: addresses.launchAuthority,
          baseMint,
          quoteMint: params.quoteMint,
          baseVault,
          quoteVault,
          launchFeeState: addresses.launchFeeState,
          payer: operator,
          authority: operator,
          hookProgram: initializer.PREDICTION_HOOK_PROGRAM_ID,
          migratorProgram:
            predictionMigrator.PREDICTION_MIGRATOR_PROGRAM_ADDRESS,
          baseTokenProgram: TOKEN_PROGRAM_ADDRESS,
          quoteTokenProgram: TOKEN_PROGRAM_ADDRESS,
          systemProgram: SYSTEM_PROGRAM_ADDRESS,
          rent: SYSVAR_RENT_ADDRESS,
          metadataAccount: addresses.metadataAccount,
        },
        {
          namespace: oracleState,
          launchId: entryId,
          baseDecimals,
          baseTotalSupply,
          baseForDistribution: 0n,
          baseForLiquidity: 0n,
          curveVirtualBase: baseTotalSupply,
          curveVirtualQuote,
          swapFeeBps: params.swapFeeBps,
          curveKind: initializer.CURVE_KIND_XYK,
          curveParams: new Uint8Array([initializer.CURVE_PARAMS_FORMAT_XYK_V0]),
          allowBuy: true,
          allowSell: true,
          hookFlags: initializer.HF_BEFORE_SWAP,
          hookPayload: new Uint8Array(),
          migratorInitPayload: predictionMigrator
            .getRegisterEntryInstructionDataEncoder()
            .encode({ entryId }),
          migratorMigratePayload: predictionMigrator
            .getMigrateEntryInstructionDataEncoder()
            .encode({ entryId }),
          hookRemainingAccountsHash: initializer.computeRemainingAccountsHash([
            oracleState,
          ]),
          migratorInitRemainingAccountsHash:
            initializer.computeRemainingAccountsHash(
              predictionRemainingAccounts,
            ),
          migratorRemainingAccountsHash:
            initializer.computeRemainingAccountsHash(
              predictionRemainingAccounts,
            ),
          feeBeneficiaries: params.feeBeneficiaries,
          ...metadata,
        },
        deployment.initializerProgram,
      );

      await sendInitializeLaunchWithLookupTable({
        clients,
        payer: operator,
        instruction: ix,
        label: `${outcome.label} initialize_launch`,
      });

      outcomes.push({
        label: outcome.label,
        entryId,
        launch: addresses.launch,
        launchAuthority: addresses.launchAuthority,
        config: addresses.config,
        baseMint: baseMint.address,
        baseVault: baseVault.address,
        quoteVault: quoteVault.address,
        launchFeeState: addresses.launchFeeState,
        entryAddress,
        entryByMint,
      });
    }

    return {
      nonce: params.nonce,
      quoteMint: params.quoteMint,
      oracleState,
      market,
      potVault,
      marketAuthority,
      outcomes: outcomes as [OutcomeRefs, OutcomeRefs],
    };
  }

  /**
   * A stake = swap on the chosen side's curve, signed by the bettor's wallet
   * (Privy embedded wallet in production; `payer` funds ATAs/fees).
   */
  async placeBet(opts: {
    refs: PairMarketRefs;
    side: 0 | 1;
    amountIn: bigint;
    bettor: TransactionSigner;
    minAmountOut?: bigint;
    /** Wrap native SOL into WSOL for the swap (quote must be WSOL). */
    wrapSol?: boolean;
    /** Sponsorship: pays the tx fee and ATA rent, NEVER the stake. The
     * SDK's own wrapSol funds the stake from the payer, so when a
     * rentPayer is set the wrap is built here with the BETTOR as source. */
    rentPayer?: TransactionSigner;
  }): Promise<{
    signature: string;
    outcomeTokenAccount: Address;
    quoteTokenAccount: Address;
  }> {
    const side = opts.refs.outcomes[opts.side];
    const payer = opts.rentPayer ?? opts.bettor;
    const swap = await curveSwapExactIn({
      deployment: {
        ...this.deployment,
        // These launches run the prediction hook, not the default launch hook
        // (SDK ≥1.0.30 renamed cpmmHookProgram -> dopplerLaunchHookV1Program).
        dopplerLaunchHookV1Program: initializer.PREDICTION_HOOK_PROGRAM_ID,
      },
      launch: side.launch,
      launchAuthority: side.launchAuthority,
      baseVault: side.baseVault,
      quoteVault: side.quoteVault,
      launchFeeState: side.launchFeeState,
      baseMint: side.baseMint,
      quoteMint: opts.refs.quoteMint,
      payer,
      user: opts.bettor,
      amountIn: opts.amountIn,
      minAmountOut: opts.minAmountOut ?? 0n,
      tradeDirection: initializer.TRADE_DIRECTION_BUY as 0 | 1,
      remainingAccounts: [opts.refs.oracleState],
      // never let the SDK wrap: its transfer source is the payer
      wrapSol: false,
    });
    const instructions = [...swap.instructions];
    if (opts.wrapSol ?? false) {
      // stake from the BETTOR, after ATA setup, before the swap
      instructions.splice(
        instructions.length - 1,
        0,
        getTransferSolInstruction({
          source: opts.bettor,
          destination: swap.userQuoteAccount,
          amount: opts.amountIn,
        }),
        getSyncNativeInstruction({ account: swap.userQuoteAccount }),
      );
    }
    const signature = await sendInstructions({
      clients: this.clients,
      payer,
      instructions,
      label: `stake side=${opts.side}`,
    });
    return {
      signature,
      outcomeTokenAccount: swap.userBaseAccount,
      quoteTokenAccount: swap.userQuoteAccount,
    };
  }

  /** Live money-odds: per-side quote-vault balances (pot-share view). */
  async getOdds(refs: PairMarketRefs): Promise<OddsView> {
    return readOdds(this.clients, refs);
  }

  /**
   * Settlement: relay the like-count verdict on-chain, then migrate both
   * entries into the pot. Finalize MUST precede migration (on-chain
   * invariant). Caller guards ZeroClaimableSupply (void when the winning
   * side raised nothing).
   */
  async resolveAndMigrate(opts: {
    refs: PairMarketRefs;
    winner: 0 | 1;
  }): Promise<{ finalizeSig: string; migrateSigs: string[] }> {
    const { refs } = opts;
    const winnerMint = refs.outcomes[opts.winner].baseMint;

    const finalizeSig = await sendInstructions({
      clients: this.clients,
      payer: this.operator,
      label: "finalize",
      instructions: [
        trustedOracle.getFinalizeInstruction({
          oracleAuthority: this.operator,
          oracleState: refs.oracleState,
          winningMint: winnerMint,
        }),
      ],
    });

    const migrateSigs: string[] = [];
    for (const side of refs.outcomes) {
      const ix = initializer.createMigrateLaunchInstruction(
        {
          config: side.config,
          launch: side.launch,
          launchAuthority: side.launchAuthority,
          baseMint: side.baseMint,
          quoteMint: refs.quoteMint,
          baseVault: side.baseVault,
          quoteVault: side.quoteVault,
          launchFeeState: side.launchFeeState,
          migratorProgram:
            predictionMigrator.PREDICTION_MIGRATOR_PROGRAM_ADDRESS,
          payer: this.operator,
          baseTokenProgram: TOKEN_PROGRAM_ADDRESS,
          quoteTokenProgram: TOKEN_PROGRAM_ADDRESS,
          systemProgram: SYSTEM_PROGRAM_ADDRESS,
          rent: SYSVAR_RENT_ADDRESS,
        },
        this.deployment.initializerProgram,
      );
      // The prediction migrator BURNS unsold base supply, so base_mint must be
      // writable (SDK builder defaults it readonly for the CPMM migrator);
      // then append the committed prediction remaining accounts.
      const withRemaining: Instruction = {
        ...ix,
        accounts: [
          ...(ix.accounts ?? []).map((acct) =>
            acct.address === side.baseMint
              ? { ...acct, role: AccountRole.WRITABLE }
              : acct,
          ),
          { address: refs.oracleState, role: AccountRole.READONLY },
          { address: refs.market, role: AccountRole.WRITABLE },
          { address: refs.potVault, role: AccountRole.WRITABLE },
          { address: refs.marketAuthority, role: AccountRole.READONLY },
          { address: side.entryAddress, role: AccountRole.WRITABLE },
          { address: side.entryByMint, role: AccountRole.WRITABLE },
        ],
      };
      migrateSigs.push(
        await sendInstructions({
          clients: this.clients,
          payer: this.operator,
          instructions: [withRemaining],
          label: `migrate ${side.label}`,
        }),
      );
    }
    return { finalizeSig, migrateSigs };
  }

  /** Burn winning tokens → pro-rata share of the pot, paid in quote. */
  async claim(opts: {
    refs: PairMarketRefs;
    winner: 0 | 1;
    claimer: TransactionSigner;
    claimerWinnerAta: Address;
    claimerQuoteAta: Address;
    burnAmount: bigint;
  }): Promise<{ signature: string }> {
    const side = opts.refs.outcomes[opts.winner];
    const ix = await predictionMigrator.getClaimInstructionAsync({
      market: opts.refs.market,
      potVault: opts.refs.potVault,
      winnerMint: side.baseMint,
      quoteMint: opts.refs.quoteMint,
      entryByMint: side.entryByMint,
      claimerWinnerAta: opts.claimerWinnerAta,
      claimerQuoteAta: opts.claimerQuoteAta,
      claimer: opts.claimer,
      payer: opts.claimer,
      baseTokenProgram: TOKEN_PROGRAM_ADDRESS,
      quoteTokenProgram: TOKEN_PROGRAM_ADDRESS,
      burnAmount: opts.burnAmount,
    });
    const signature = await sendInstructions({
      clients: this.clients,
      payer: opts.claimer,
      instructions: [ix],
      label: "claim",
    });
    return { signature };
  }

  /** Pot state after (partial) migration/claims. */
  async getMarketState(refs: PairMarketRefs) {
    const account = await predictionMigrator.fetchMarket(
      this.clients.rpc,
      refs.market,
    );
    return account.data;
  }
}

/**
 * Rebuild PairMarketRefs from the chain alone. Everything except the two
 * base mints is PDA-derived (oracle from operator+nonce, market family
 * from the oracle, launch family from the mint); the mints — random
 * keypairs at creation — are read back from the prediction entry
 * accounts, and the vaults from the launch accounts. This is what lets
 * ANY process (web routes, a restarted agent) act on a market knowing
 * only its nonce, the operator address, and the two outcome labels.
 */
export async function recoverRefs(opts: {
  clients: Clients;
  operatorAddress: Address;
  nonce: bigint;
  labels: [string, string];
  quoteMint?: Address;
  deployment?: SolanaCpmmDeployment;
}): Promise<PairMarketRefs> {
  const deployment =
    opts.deployment ??
    (await deriveSolanaCpmmDeployment(DOPPLER_SOLANA_DEVNET_PROGRAM_ADDRESSES));
  const quoteMint = opts.quoteMint ?? WSOL_MINT;
  const [oracleState] = await trustedOracle.getOracleStateAddress(
    opts.operatorAddress,
    opts.nonce,
  );
  const [market] = await predictionMigrator.getPredictionMarketAddress(
    oracleState,
    quoteMint,
  );
  const [potVault] =
    await predictionMigrator.getPredictionPotVaultAddress(market);
  const [marketAuthority] =
    await predictionMigrator.getPredictionMarketAuthorityAddress(market);

  const outcomes: OutcomeRefs[] = [];
  for (const label of opts.labels) {
    const entryId = new Uint8Array(32);
    entryId.set(new TextEncoder().encode(label).slice(0, 32));
    const [entryAddress] = await predictionMigrator.getPredictionEntryAddress(
      market,
      entryId,
    );
    const entry = await predictionMigrator.fetchEntry(
      opts.clients.rpc,
      entryAddress,
    );
    const baseMint = entry.data.baseMint;
    const [entryByMint] =
      await predictionMigrator.getPredictionEntryByMintAddress(
        market,
        baseMint,
      );
    const addresses = await initializer.deriveCreateLaunchAddresses({
      deployment,
      namespace: oracleState,
      launchId: entryId,
      baseMint,
    });
    const launch = await initializer.fetchLaunch(
      opts.clients.rpc,
      addresses.launch,
    );
    if (!launch) throw new Error(`no launch account at ${addresses.launch}`);
    outcomes.push({
      label,
      entryId,
      launch: addresses.launch,
      launchAuthority: addresses.launchAuthority,
      config: addresses.config,
      baseMint,
      baseVault: launch.baseVault,
      quoteVault: launch.quoteVault,
      launchFeeState: addresses.launchFeeState,
      entryAddress,
      entryByMint,
    });
  }

  return {
    nonce: opts.nonce,
    quoteMint,
    oracleState,
    market,
    potVault,
    marketAuthority,
    outcomes: outcomes as [OutcomeRefs, OutcomeRefs],
  };
}

/**
 * Claim a bettor's full winning balance and unwrap the payout: burns all
 * their winner tokens for the pro-rata pot share (paid in WSOL), then
 * closes their WSOL ATA so the payout lands as NATIVE SOL in the wallet
 * and the WSOL account rent comes back too. Custodial flow: the agent
 * runs this for every winner at settlement — winning must not require a
 * claim button. Returns null when the bettor holds no winner tokens.
 */
export async function claimAndUnwrap(opts: {
  clients: Clients;
  refs: PairMarketRefs;
  winner: 0 | 1;
  claimer: TransactionSigner;
}): Promise<{ signature: string; paidLamports: bigint } | null> {
  const { clients, refs, winner, claimer } = opts;
  const side = refs.outcomes[winner];
  const [winnerAta] = await findAssociatedTokenPda({
    mint: side.baseMint,
    owner: claimer.address,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });
  const winnerAcc = await clients.rpc
    .getTokenAccountBalance(winnerAta)
    .send()
    .catch(() => null);
  const burnAmount = BigInt(winnerAcc?.value.amount ?? "0");
  if (burnAmount === 0n) return null;

  const [quoteAta] = await findAssociatedTokenPda({
    mint: refs.quoteMint,
    owner: claimer.address,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });
  const claimIx = await predictionMigrator.getClaimInstructionAsync({
    market: refs.market,
    potVault: refs.potVault,
    winnerMint: side.baseMint,
    quoteMint: refs.quoteMint,
    entryByMint: side.entryByMint,
    claimerWinnerAta: winnerAta,
    claimerQuoteAta: quoteAta,
    claimer,
    payer: claimer,
    baseTokenProgram: TOKEN_PROGRAM_ADDRESS,
    quoteTokenProgram: TOKEN_PROGRAM_ADDRESS,
    burnAmount,
  });
  // WSOL quote only: closing the quote ATA unwraps the payout to native
  // SOL and refunds that account's rent in the same transaction. USDC
  // production drops the close (you keep a USDC account).
  const closeIx = getCloseAccountInstruction({
    account: quoteAta,
    destination: claimer.address,
    owner: claimer,
  });
  const before = await clients.rpc.getBalance(claimer.address).send();
  const signature = await sendInstructions({
    clients,
    payer: claimer,
    instructions: [claimIx, closeIx],
    label: "claim+unwrap",
  });
  const after = await clients.rpc.getBalance(claimer.address).send();
  return { signature, paidLamports: after.value - before.value };
}
