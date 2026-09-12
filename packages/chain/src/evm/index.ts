/**
 * EvmMarketChain — ratio on Base Sepolia, behind the same seam the Solana
 * client fills. The engine cannot tell them apart.
 *
 * Doppler owns entry pricing (one Uniswap v4 pool per side) and settlement
 * (PredictionMigrator holds the pot and pays token-weighted claims). We own
 * exactly one contract, RatioOracle, which reports the likes verdict. Addresses
 * and the transactions that proved this path: contracts/BASE-SEPOLIA.md.
 *
 * Three things differ from the Solana implementation in ways worth knowing:
 *
 * REFS ARE DERIVED, NOT STORED. DopplerMarketChain keeps a PairMarketRefs map
 * and recovers from chain when a container restarts. Here everything falls out
 * of the market id: the oracle address is CREATE2-deterministic from the
 * factory, and the two entry tokens are stored on the oracle. Nothing to
 * recover and nothing to lose on restart.
 *
 * USD IS A DISPLAY UNIT. The engine speaks dollars because the product does
 * ("@ratio $25 on A"). The chain is ETH. Conversion happens here, at bet time,
 * through an injected price source. It sizes a stake and nothing else — every
 * quote, fee, pot and payout below is wei underneath, and settlement is
 * token-weighted parimutuel that never reads a price. A wrong or missing feed
 * can mis-size a bet; it cannot mis-settle a market.
 *
 * ODDS COME FROM INDEXED EVENTS. Uniswap v4 is a singleton: every pool's ETH
 * sits in one PoolManager balance, so "how much has side A raised" is not a
 * chain read. It is a sum over that side's swaps, which is precisely what the
 * subgraph indexes (contracts/EVENTS.md). So it is injected rather than faked
 * from token supply, which would be wrong in exactly the direction that makes
 * the pot bar lie.
 */
import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  encodeAbiParameters,
  encodePacked,
  http,
  keccak256,
  toHex,
  parseAbiParameters,
  parseEther,
  type Account,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { baseSepolia } from "viem/chains";

import type { ChainRefs, FeeBeneficiary, MarketChain, Odds, Stake } from "../index.js";
import {
  airlockAbi,
  erc20Abi,
  poolSwapAbi,
  predictionMigratorAbi,
  ratioOracleAbi,
  ratioOracleFactoryAbi,
} from "./abis.js";
import { buildBeneficiaries } from "./beneficiaries.js";
import { SerialQueue } from "./serial.js";

export { BASE_SEPOLIA, BASE_SEPOLIA_RPC, BASE_SEPOLIA_CHAIN_ID } from "./addresses.js";
export { coinbaseEthUsd, fixedEthUsd, StalePriceError, type PriceSource } from "./price.js";
export { SerialQueue } from "./serial.js";
export { buildBeneficiaries, BeneficiaryError } from "./beneficiaries.js";
export {
  RatioSubgraph,
  SubgraphError,
  type SideTotals,
  type TradePoint,
  type TrendingMarket,
  type LeaderRow,
  type IndexedMarket,
  type IndexedTrade,
  type IndexedWorld,
} from "./subgraph.js";

/** The initializer always creates the pool with the dynamic-fee flag, whatever
 * InitData.fee says. A PoolKey built with any other fee silently misses the
 * pool — found by reading modifyLiquidity args out of a call trace. */
const DYNAMIC_FEE_FLAG = 0x800000;
const TICK_SPACING = 8;
/** Native ETH is currency0: address(0) sorts before every token. */
const NATIVE = "0x0000000000000000000000000000000000000000" as const;
const MIN_SQRT_PRICE_PLUS_ONE = 4295128740n;

export interface EvmAddresses {
  airlock: Address;
  predictionMigrator: Address;
  noSellHook: Address;
  hookInitializer: Address;
  governanceFactory: Address;
  /** clone_derc20_v2_votes_factory. NOT token_factory_80, whose token has an
   * owner-gated burn() the migrator can never call — see FEEDBACK.md §2. */
  tokenFactory: Address;
  poolManager: Address;
  /** v4-core PoolSwapTest, deployed once and reused as the bet rail. */
  swapRouter: Address;
  ratioOracleFactory: Address;
}

export interface EvmMarketChainOpts {
  rpcUrl: string;
  addresses: EvmAddresses;
  /** Signs as the operator: opens markets and declares winners. */
  operator: Account;
  /** Resolves a bettor's address to a signer (Privy in production). */
  signerFor: (walletAddress: string) => Account;
  /** USD per 1 ETH. Display and sizing only; never an input to settlement. */
  ethUsd: () => Promise<number>;
  /**
   * Net wei staked on each side, from indexed swaps. See the note above on why
   * this cannot be a chain read.
   */
  raisedWeiFor: (marketId: string) => Promise<[bigint, bigint]>;
  /** Market duration, to set the oracle's settlesAt. */
  marketDurationMs: number;
  now?: () => number;
}

export class EvmMarketChain implements MarketChain {
  private readonly pub: PublicClient;
  private readonly wallets = new Map<string, WalletClient>();
  /** One transaction in flight per account — EVM nonces are sequential. */
  private readonly queue = new SerialQueue();
  /**
   * Entry tokens we set ourselves, by market id.
   *
   * Not an optimisation. waitForTransactionReceipt confirms setEntryTokens,
   * but the very next readContract can land on a different node behind the
   * RPC's load balancer that has not caught up, and read back two zero
   * addresses — which is indistinguishable from "not attached yet". The
   * treasury seed runs immediately after creation and hit exactly that.
   *
   * Remembering what we just wrote removes the race and a round trip per bet.
   */
  private readonly tokensByMarket = new Map<string, [Address, Address]>();

  constructor(private readonly opts: EvmMarketChainOpts) {
    this.pub = createPublicClient({
      chain: baseSepolia,
      transport: http(opts.rpcUrl),
    }) as PublicClient;
  }

  /**
   * Send one transaction and wait for it, with at most one in flight per
   * account. Both halves must be inside the queue: releasing after the send
   * lets the next call ask for a nonce while the previous transaction is still
   * in the mempool, and the node hands back the same one.
   */
  private async send(
    account: Account,
    write: (w: WalletClient) => Promise<`0x${string}`>,
  ) {
    return this.queue.run(account.address, async () => {
      const hash = await write(this.wallet(account));
      const receipt = await this.pub.waitForTransactionReceipt({ hash });
      /**
       * A mined transaction is not a successful one. Without this check a
       * revert reads as success all the way up: the approve before a claim
       * reverted, the claim then failed with TRANSFER_FROM_FAILED against a
       * zero allowance, and a settlement whose migration reverted still
       * marked the market settled — money stranded in a pool with the store
       * saying it had been paid out.
       */
      if (receipt.status !== "success") {
        throw new Error(`transaction reverted: ${hash}`);
      }
      return receipt;
    });
  }

  private wallet(account: Account): WalletClient {
    const key = account.address.toLowerCase();
    let w = this.wallets.get(key);
    if (!w) {
      w = createWalletClient({ account, chain: baseSepolia, transport: http(this.opts.rpcUrl) });
      this.wallets.set(key, w);
    }
    return w;
  }

  /**
   * A stake to wei. Said in ETH, it passes STRAIGHT through — no rate is
   * consulted, so "0.01" is exactly 0.01 and a broken price feed cannot touch
   * it. Only a dollar amount needs the rate.
   */
  private async stakeToWei(stake: Stake): Promise<bigint> {
    if ("native" in stake) return parseEther(stake.native.toFixed(18));
    return this.usdToWei(stake.usd);
  }

  async stakeUsd(stake: Stake): Promise<number> {
    if ("usd" in stake) return stake.usd;
    return stake.native * (await this.opts.ethUsd());
  }

  private async usdToWei(usd: number): Promise<bigint> {
    const price = await this.opts.ethUsd();
    if (!Number.isFinite(price) || price <= 0) {
      throw new Error(`ethUsd returned ${price}; refusing to size a bet on it`);
    }
    // Fixed-point via string to avoid float drift on the way into wei.
    return parseEther((usd / price).toFixed(18));
  }

  private async weiToUsd(wei: bigint): Promise<number> {
    const price = await this.opts.ethUsd();
    return (Number(wei) / 1e18) * price;
  }

  // -------------------------------------------------------------------------
  // Refs: everything derives from the market id
  // -------------------------------------------------------------------------

  /** Public form of the CREATE2 derivation, for the subgraph lookup. */
  async oracleFor(marketId: string): Promise<Address> {
    return this.oracleAddress(marketId);
  }

  private async oracleAddress(marketId: string): Promise<Address> {
    return this.pub.readContract({
      address: this.opts.addresses.ratioOracleFactory,
      abi: ratioOracleFactoryAbi,
      functionName: "predictOracle",
      args: [BigInt(marketId)],
    });
  }

  private async entryTokens(marketId: string): Promise<[Address, Address]> {
    const known = this.tokensByMarket.get(marketId);
    if (known) return known;
    const oracle = await this.oracleAddress(marketId);
    const [a, b] = await Promise.all([
      this.pub.readContract({
        address: oracle,
        abi: ratioOracleAbi,
        functionName: "entryTokens",
        args: [0n],
      }),
      this.pub.readContract({
        address: oracle,
        abi: ratioOracleAbi,
        functionName: "entryTokens",
        args: [1n],
      }),
    ]);
    if (a === NATIVE || b === NATIVE) {
      throw new Error(`market ${marketId}: entry tokens not attached yet`);
    }
    this.tokensByMarket.set(marketId, [a, b]);
    return [a, b];
  }

  private poolKey(token: Address) {
    return {
      currency0: NATIVE as Address,
      currency1: token,
      fee: DYNAMIC_FEE_FLAG,
      tickSpacing: TICK_SPACING,
      hooks: this.opts.addresses.hookInitializer,
    } as const;
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  async createMarket(params: {
    nonce: string;
    feeBeneficiaries: FeeBeneficiary[];
    outcomes: [string, string];
    settlesAtMs?: number;
  }): Promise<ChainRefs> {
    const { addresses, operator } = this.opts;
    // The engine's number, not ours. Deriving it here from a later clock is
    // how the store and the contract end up disagreeing about when a market
    // closes — by exactly the time creation takes.
    const settlesAtMs =
      params.settlesAtMs ?? (this.opts.now?.() ?? Date.now()) + this.opts.marketDurationMs;
    const settlesAt = BigInt(Math.floor(settlesAtMs / 1000));

    // The airlock owner must be a beneficiary holding >= 5%; our Doppler slice
    // pays to it. Read rather than configured, so a chain swap cannot silently
    // point the protocol slice at a stale address.
    const airlockOwner = await this.pub.readContract({
      address: addresses.airlock,
      abi: airlockAbi,
      functionName: "owner",
    });
    // Still computed and validated even though it cannot be applied yet: it
    // catches a malformed split at creation rather than whenever the upstream
    // constraint lifts, and it keeps the five-way economics honest in the log.
    const beneficiaries = buildBeneficiaries(params.feeBeneficiaries, airlockOwner);
    void beneficiaries;

    await this.send(operator, (w) =>
      w.writeContract({
        address: addresses.ratioOracleFactory,
        abi: ratioOracleFactoryAbi,
        functionName: "createOracle",
        args: [BigInt(params.nonce), settlesAt],
        chain: baseSepolia,
        account: operator,
      }),
    );
    const oracle = await this.oracleAddress(params.nonce);

    const tokens: Address[] = [];
    for (const side of [0, 1] as const) {
      tokens.push(
        await this.createEntry({
          oracle,
          side,
          label: params.outcomes[side],
          marketId: params.nonce,
          beneficiaries,
        }),
      );
    }

    await this.send(operator, (w) =>
      w.writeContract({
        address: oracle,
        abi: ratioOracleAbi,
        functionName: "setEntryTokens",
        args: [tokens[0]!, tokens[1]!],
        chain: baseSepolia,
        account: operator,
      }),
    );

    this.tokensByMarket.set(params.nonce, [tokens[0]!, tokens[1]!]);
    return { marketId: params.nonce };
  }

  private async createEntry(a: {
    oracle: Address;
    side: 0 | 1;
    label: string;
    marketId: string;
    beneficiaries: ReturnType<typeof buildBeneficiaries>;
  }): Promise<Address> {
    const { addresses, operator } = this.opts;
    const symbol = a.side === 0 ? "RTOA" : "RTOB";

    // CloneDERC20VotesV2Factory's shape: (name, symbol, yearlyMintRate,
    // VestingSchedule[], beneficiaries, scheduleIds, amounts, tokenURI).
    // Undocumented; recovered from legacy/src/tokens.
    const tokenFactoryData = encodeAbi(
      ["string", "string", "uint256", "(uint64,uint64)[]", "address[]", "uint256[]", "uint256[]", "string"],
      [a.label.slice(0, 32), symbol, 0n, [], [], [], [], ""],
    );

    const poolInitializerData = encodeAbi(
      [
        "(uint24,int24,int24,(int24,int24,uint16,uint256)[],(address,uint96)[],address,bytes,bytes)",
      ],
      [
        [
          0,
          TICK_SPACING,
          // farTick == startTick: migration is gated by the ORACLE, not by
          // price. This is the constraint Whetstone removed for prediction
          // markets, and the whole design rests on it.
          0,
          [[0, 240_000, 10, 10n ** 18n]],
          /**
           * EMPTY, and it has to be. This is upstream's constraint, not a
           * choice, and getting it wrong strands money permanently:
           *
           *   status: beneficiaries.length != 0 ? Locked : Initialized
           *
           * A pool with a fee split is created Locked. Airlock.migrate calls
           * exitLiquidity, which requires Initialized and reverts
           * WrongPoolStatus(Initialized, Locked). The other route out,
           * graduate(), requires a doppler hook carrying ON_GRADUATION_FLAG
           * (4) — and NoSellDopplerHook, the hook prediction markets must use,
           * is enabled with flags 3. So a prediction pool with beneficiaries
           * can never exit and never graduate: bets go in and nothing comes
           * out, for anyone.
           *
           * So on Base Sepolia today a prediction market can take a fee split
           * or it can settle, never both. A market that cannot pay out is not
           * a market, so we take no fee and say so. Written up in FEEDBACK.md.
           *
           * buildBeneficiaries stays and stays tested — it is exactly what
           * goes here the moment upstream lifts this.
           */
          [] as never[],
          addresses.noSellHook,
          "0x",
          "0x",
        ],
      ],
    );

    const receipt = await this.send(operator, (w) =>
      w.writeContract({
        address: addresses.airlock,
      abi: airlockAbi,
      functionName: "create",
      args: [
        {
          initialSupply: 10n ** 24n,
          numTokensToSell: 10n ** 24n,
          numeraire: NATIVE,
          tokenFactory: addresses.tokenFactory,
          tokenFactoryData,
          governanceFactory: addresses.governanceFactory,
          governanceFactoryData: encodeAbi(["string"], [a.label.slice(0, 32)]),
          poolInitializer: addresses.hookInitializer,
          poolInitializerData,
          liquidityMigrator: addresses.predictionMigrator,
          // (oracle, entryId). entryId is just the side index — the migrator
          // only needs uniqueness within a market.
          liquidityMigratorData: encodeAbi(
            ["address", "bytes32"],
            [a.oracle, `0x${a.side.toString(16).padStart(64, "0")}` as Hex],
          ),
          integrator: NATIVE,
          salt: keccakSalt(a.marketId, a.side),
        },
      ],
        chain: baseSepolia,
        account: operator,
      }),
    );
    const asset = assetFromCreateReceipt(receipt.logs, addresses.airlock);
    if (!asset) {
      throw new Error(`create side ${a.side}: no asset in receipt ${receipt.transactionHash}`);
    }
    return asset;
  }

  async placeBet(params: {
    refs: ChainRefs;
    side: 0 | 1;
    stake: Stake;
    bettor: string;
  }): Promise<{ tokensOut: number; signature: string }> {
    const tokens = await this.entryTokens(params.refs.marketId);
    const token = tokens[params.side];
    const account = this.opts.signerFor(params.bettor);
    const wei = await this.stakeToWei(params.stake);

    const receipt = await this.send(account, (w) =>
      w.writeContract({
        address: this.opts.addresses.swapRouter,
      abi: poolSwapAbi,
      functionName: "swap",
      args: [
        this.poolKey(token),
        { zeroForOne: true, amountSpecified: -wei, sqrtPriceLimitX96: MIN_SQRT_PRICE_PLUS_ONE },
        { takeClaims: false, settleUsingBurn: false },
        "0x",
      ],
        value: wei,
        chain: baseSepolia,
        account,
      }),
    );
    /**
     * The position, read out of the RECEIPT rather than from a balance delta.
     *
     * A before/after balance pair needs two reads around a write, and public
     * RPCs are load balanced — the second read can land on a replica that has
     * not seen the swap yet and report a delta of zero. The receipt is the
     * authoritative record of what the transaction did and cannot be stale.
     *
     * This is also the number that was hardcoded to 0 on Solana, where it sat
     * in an associated token account the swap never reported back and every
     * token-weighted figure in the product quietly divided by it.
     */
    const tokensOut = tokensReceived(receipt.logs, token, account.address);
    if (tokensOut <= 0n) {
      throw new Error(`bet landed (${receipt.transactionHash}) but yielded no tokens`);
    }
    return { tokensOut: Number(tokensOut), signature: receipt.transactionHash };
  }

  /**
   * Quote by SIMULATING the swap, never by dividing pot totals. Entry is
   * curve-priced, so tokensOut is the unit of payout and a linear pot-share
   * approximation overstates large stakes.
   */
  async previewStake(params: {
    refs: ChainRefs;
    side: 0 | 1;
    stake: Stake;
  }): Promise<{ tokensOut: number; feeUsd: number }> {
    const tokens = await this.entryTokens(params.refs.marketId);
    const wei = await this.stakeToWei(params.stake);

    const { result } = await this.pub.simulateContract({
      address: this.opts.addresses.swapRouter,
      abi: poolSwapAbi,
      functionName: "swap",
      args: [
        this.poolKey(tokens[params.side]),
        { zeroForOne: true, amountSpecified: -wei, sqrtPriceLimitX96: MIN_SQRT_PRICE_PLUS_ONE },
        { takeClaims: false, settleUsingBurn: false },
        "0x",
      ],
      value: wei,
      account: this.opts.operator,
      /**
       * A quote must not depend on who is asking. The simulation sends real
       * value, so without this a $500 quote fails for insufficient funds
       * against whatever the operator happens to hold — the number a bettor
       * sees would move with our treasury balance, and the largest stakes,
       * where curve pricing matters most, would be the ones that could not be
       * quoted at all.
       */
      stateOverride: [{ address: this.opts.operator.address, balance: parseEther("100000") }],
    });
    // BalanceDelta packs two int128s; the low half is currency1 (the token).
    const tokensOut = BigInt.asIntN(128, BigInt(result as bigint));
    return {
      tokensOut: Number(tokensOut < 0n ? -tokensOut : tokensOut),
      // The pool runs a dynamic fee set by the hook, so the swap fee is not a
      // constant we can assert here. Reported by the indexer instead.
      feeUsd: 0,
    };
  }

  async getOdds(refs: ChainRefs): Promise<Odds> {
    const [a, b] = await this.opts.raisedWeiFor(refs.marketId);
    const total = a + b;
    const [usdA, usdB] = await Promise.all([this.weiToUsd(a), this.weiToUsd(b)]);
    return {
      impliedA: total === 0n ? 0.5 : Number(a) / Number(total),
      raisedUsd: [usdA, usdB],
    };
  }

  async settle(params: { refs: ChainRefs; winner: 0 | 1 }): Promise<{ winner: 0 | 1 }> {
    const { operator, addresses } = this.opts;
    const oracle = await this.oracleAddress(params.refs.marketId);
    const tokens = await this.entryTokens(params.refs.marketId);

    /**
     * Settlement is idempotent from any point it previously stopped at.
     *
     * A settlement that declared the winner and then failed at migration
     * leaves the oracle finalized and the pot in the pools. Rerunning it must
     * not try to declare again — the oracle refuses a second verdict, which
     * is correct — and must not contradict the first one: the chain's verdict
     * is the verdict. So it reads first, declares only if nothing has been
     * declared, and carries on to migration from there.
     */
    const [declaredToken, alreadyFinal] = await this.pub.readContract({
      address: oracle,
      abi: ratioOracleAbi,
      functionName: "getWinner",
      args: [oracle],
    });
    let winner = params.winner;
    if (alreadyFinal) {
      const declared = tokens.findIndex((t) => t.toLowerCase() === declaredToken.toLowerCase());
      if (declared === 0 || declared === 1) {
        if (declared !== params.winner) {
          console.error(
            `  market ${params.refs.marketId}: chain already holds side ${declared} as winner, engine computed ${params.winner} — the chain's verdict stands`,
          );
        }
        winner = declared;
      }
      console.log(`  market ${params.refs.marketId}: verdict already on chain, resuming at migration`);
    } else {
      // The verdict. Terminal, and the migrator reads it exactly once.
      await this.send(operator, (w) =>
        w.writeContract({
          address: oracle,
          abi: ratioOracleAbi,
          functionName: "declareWinner",
          args: [params.winner, 0n, 0n, false],
          chain: baseSepolia,
          account: operator,
        }),
      );
    }

    /**
     * Wait until a READ sees the verdict before migrating.
     *
     * The write is confirmed by then — we hold its receipt — but Base's public
     * RPC is load balanced, and the node that answers the next call can be a
     * block or two behind the one that mined it. Migration asks the oracle who
     * won, gets "nobody yet" from a stale node, and reverts.
     *
     * That is how markets ended up resolved on chain with their proceeds
     * stranded in the pools: the revert was invisible (see `send`), so
     * settlement carried on and recorded a payout that never happened. Reading
     * our own write back is the cheap half of the fix.
     */
    for (let i = 0; ; i++) {
      const finalized = await this.pub.readContract({
        address: oracle,
        abi: ratioOracleAbi,
        functionName: "isFinalized",
      });
      if (finalized) break;
      if (i >= 30) {
        throw new Error(`oracle ${oracle} still reads unfinalized after declareWinner`);
      }
      await new Promise((r) => setTimeout(r, 1_000));
    }

    // Migration is a separate step on EVM: Airlock moves each entry's proceeds
    // into the pot, and claims revert until the WINNING entry has migrated.
    for (const token of tokens) {
      // An entry that migrated in an earlier attempt reverts here, and the
      // migrator exposes no getter to ask first. So a revert is tolerated per
      // entry, and what is checked instead is the thing that matters: that
      // the WINNING entry is claimable when the loop is done.
      try {
        await this.send(operator, (w) =>
          w.writeContract({
            address: addresses.airlock,
            abi: airlockAbi,
            functionName: "migrate",
            args: [token],
            chain: baseSepolia,
            account: operator,
          }),
        );
      } catch (err) {
        console.log(`  migrate ${token} did not land (${(err as Error).message.slice(0, 80)}); checking claimability`);
      }
    }
    // Reverts until the winning entry has migrated. This is the assertion.
    await this.pub.readContract({
      address: addresses.predictionMigrator,
      abi: predictionMigratorAbi,
      functionName: "previewClaim",
      args: [oracle, 1n],
    });
    return { winner };
  }

  async claimFor(params: {
    refs: ChainRefs;
    winner: 0 | 1;
    bettor: string;
  }): Promise<{ paidUsd: number } | null> {
    const { addresses } = this.opts;
    const oracle = await this.oracleAddress(params.refs.marketId);
    const tokens = await this.entryTokens(params.refs.marketId);
    const winningToken = tokens[params.winner];
    const account = this.opts.signerFor(params.bettor);

    const held = await this.tokenBalance(winningToken, account.address);
    if (held === 0n) return null; // holds nothing on the winning side

    const payout = await this.pub.readContract({
      address: addresses.predictionMigrator,
      abi: predictionMigratorAbi,
      functionName: "previewClaim",
      args: [oracle, held],
    });

    // approve then claim: two transactions from one account back to back,
    // which is exactly the nonce case, so both go through the queue.
    await this.send(account, (w) =>
      w.writeContract({
        address: winningToken,
        abi: erc20Abi,
        functionName: "approve",
        args: [addresses.predictionMigrator, held],
        chain: baseSepolia,
        account,
      }),
    );
    /**
     * Do not claim until the allowance can be READ back.
     *
     * `claim` pulls the tokens with `transferFrom`, and every failure inside
     * the token surfaces as the same Solmate string, `TRANSFER_FROM_FAILED`,
     * which names neither the allowance nor the reason. We spent a settlement
     * on that message: the approve had confirmed, and the claim still could
     * not see it, because a load-balanced RPC answers from whichever node it
     * likes and the next one had not caught up.
     *
     * So the allowance is the precondition and it is checked as one, rather
     * than assumed from a receipt.
     */
    for (let i = 0; ; i++) {
      const allowed = await this.pub.readContract({
        address: winningToken,
        abi: erc20Abi,
        functionName: "allowance",
        args: [account.address, addresses.predictionMigrator],
      });
      if (allowed >= held) break;
      if (i >= 30) {
        throw new Error(
          `claim for ${account.address} blocked: allowance ${allowed} < ${held} after approve`,
        );
      }
      await new Promise((r) => setTimeout(r, 1_000));
    }

    const receipt = await this.send(account, (w) =>
      w.writeContract({
        address: addresses.predictionMigrator,
        abi: predictionMigratorAbi,
        functionName: "claim",
        args: [oracle, held],
        chain: baseSepolia,
        account,
      }),
    );

    // What was paid, from the payment itself. The preview above is only a
    // quote, and a stale node answers it with zero.
    const paidWei = claimedFromLogs(receipt.logs, addresses.predictionMigrator) ?? payout;
    return { paidUsd: await this.weiToUsd(paidWei) };
  }

  // -------------------------------------------------------------------------
  // Quote asset / wallet surface
  // -------------------------------------------------------------------------

  async balanceUsd(walletAddress: string): Promise<number> {
    const wei = await this.pub.getBalance({ address: walletAddress as Address });
    return this.weiToUsd(wei);
  }

  /** No per-token account rent on EVM. The concept is Solana's alone. */
  async reservedUsd(): Promise<number> {
    return 0;
  }

  async transferUsd(opts: {
    from: string;
    to: string;
    amountUsd: number;
  }): Promise<{ signature: string }> {
    const account = this.opts.signerFor(opts.from);
    const value = await this.stakeToWei({ usd: opts.amountUsd });
    const receipt = await this.send(account, (w) =>
      w.sendTransaction({ to: opts.to as Address, value, chain: baseSepolia, account }),
    );
    return { signature: receipt.transactionHash };
  }

  isValidAddress(candidate: string): boolean {
    return /^0x[0-9a-fA-F]{40}$/.test(candidate);
  }

  /**
   * The address Doppler's fee split must include with at least 5%. A protocol
   * fact, not a configuration choice, so it is read rather than trusted from
   * an env var that could go stale against a redeployed Airlock.
   */
  async airlockOwner(): Promise<Address> {
    return this.pub.readContract({
      address: this.opts.addresses.airlock,
      abi: airlockAbi,
      functionName: "owner",
    });
  }

  private async tokenBalance(token: Address, owner: Address): Promise<bigint> {
    return this.pub.readContract({
      address: token,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [owner],
    });
  }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------


function encodeAbi(types: string[], values: readonly unknown[]): Hex {
  return encodeAbiParameters(parseAbiParameters(types.join(", ")), values as never);
}

function keccakSalt(marketId: string, side: number): Hex {
  return keccak256(encodePacked(["uint256", "uint8"], [BigInt(marketId), side]));
}

/** ERC20 Transfer(address,address,uint256). */
const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef" as const;

/** The numeraire paid out by a `Claimed` event in this receipt, if there is one. */
function claimedFromLogs(
  logs: readonly { address: string; topics: readonly Hex[]; data: Hex }[],
  migrator: string,
): bigint | null {
  const topic0 = keccak256(toHex("Claimed(address,address,uint256,uint256)"));
  for (const log of logs) {
    if (log.address.toLowerCase() !== migrator.toLowerCase()) continue;
    if (log.topics[0]?.toLowerCase() !== topic0.toLowerCase()) continue;
    // data = tokensBurned (32 bytes) then numeraireReceived (32 bytes).
    const data = log.data.slice(2);
    if (data.length < 128) continue;
    return BigInt(`0x${data.slice(64, 128)}`);
  }
  return null;
}

/**
 * Tokens of `token` credited to `to` in this receipt, summed across transfers.
 * Reading the log rather than a balance avoids the read-replica race entirely.
 */
function tokensReceived(
  logs: readonly { address: string; topics: readonly Hex[]; data: Hex }[],
  token: Address,
  to: Address,
): bigint {
  let total = 0n;
  const want = to.toLowerCase();
  for (const log of logs) {
    if (log.address.toLowerCase() !== token.toLowerCase()) continue;
    if (log.topics[0]?.toLowerCase() !== TRANSFER_TOPIC) continue;
    const recipient = log.topics[2];
    if (!recipient) continue;
    if (`0x${recipient.slice(26)}`.toLowerCase() !== want) continue;
    total += BigInt(log.data);
  }
  return total;
}

/** Airlock emits Create(asset, numeraire, initializer, poolOrHook). */
function assetFromCreateReceipt(
  logs: readonly { address: string; topics: readonly Hex[]; data: Hex }[],
  airlock: Address,
): Address | undefined {
  const createAbi = [
    {
      type: "event",
      name: "Create",
      inputs: [
        { name: "asset", type: "address", indexed: false },
        { name: "numeraire", type: "address", indexed: true },
        { name: "initializer", type: "address", indexed: false },
        { name: "poolOrHook", type: "address", indexed: false },
      ],
    },
  ] as const;
  for (const log of logs) {
    if (log.address.toLowerCase() !== airlock.toLowerCase()) continue;
    try {
      const parsed = decodeEventLog({
        abi: createAbi,
        data: log.data,
        topics: log.topics as [Hex, ...Hex[]],
      });
      return parsed.args.asset as Address;
    } catch {
      // not the Create event
    }
  }
  return undefined;
}
