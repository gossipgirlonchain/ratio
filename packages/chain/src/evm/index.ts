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
  parseAbiParameters,
  parseEther,
  type Account,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { baseSepolia } from "viem/chains";

import type { ChainRefs, FeeBeneficiary, MarketChain, Odds } from "../index.js";
import {
  airlockAbi,
  erc20Abi,
  poolSwapAbi,
  predictionMigratorAbi,
  ratioOracleAbi,
  ratioOracleFactoryAbi,
} from "./abis.js";
import { buildBeneficiaries } from "./beneficiaries.js";

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

  constructor(private readonly opts: EvmMarketChainOpts) {
    this.pub = createPublicClient({
      chain: baseSepolia,
      transport: http(opts.rpcUrl),
    }) as PublicClient;
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

  private async oracleAddress(marketId: string): Promise<Address> {
    return this.pub.readContract({
      address: this.opts.addresses.ratioOracleFactory,
      abi: ratioOracleFactoryAbi,
      functionName: "predictOracle",
      args: [BigInt(marketId)],
    });
  }

  private async entryTokens(marketId: string): Promise<[Address, Address]> {
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
  }): Promise<ChainRefs> {
    const { addresses, operator } = this.opts;
    const wallet = this.wallet(operator);
    const now = this.opts.now?.() ?? Date.now();
    const settlesAt = BigInt(Math.floor((now + this.opts.marketDurationMs) / 1000));

    // The airlock owner must be a beneficiary holding >= 5%; our Doppler slice
    // pays to it. Read rather than configured, so a chain swap cannot silently
    // point the protocol slice at a stale address.
    const airlockOwner = await this.pub.readContract({
      address: addresses.airlock,
      abi: airlockAbi,
      functionName: "owner",
    });
    const beneficiaries = buildBeneficiaries(params.feeBeneficiaries, airlockOwner);

    const oracleHash = await wallet.writeContract({
      address: addresses.ratioOracleFactory,
      abi: ratioOracleFactoryAbi,
      functionName: "createOracle",
      args: [BigInt(params.nonce), settlesAt],
      chain: baseSepolia,
      account: operator,
    });
    await this.pub.waitForTransactionReceipt({ hash: oracleHash });
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

    const setHash = await wallet.writeContract({
      address: oracle,
      abi: ratioOracleAbi,
      functionName: "setEntryTokens",
      args: [tokens[0]!, tokens[1]!],
      chain: baseSepolia,
      account: operator,
    });
    await this.pub.waitForTransactionReceipt({ hash: setHash });

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
          a.beneficiaries.map((b) => [b.beneficiary, b.shares]),
          addresses.noSellHook,
          "0x",
          "0x",
        ],
      ],
    );

    const wallet = this.wallet(operator);
    const hash = await wallet.writeContract({
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
    });
    const receipt = await this.pub.waitForTransactionReceipt({ hash });
    const asset = assetFromCreateReceipt(receipt.logs, addresses.airlock);
    if (!asset) throw new Error(`create side ${a.side}: no asset in receipt ${hash}`);
    return asset;
  }

  async placeBet(params: {
    refs: ChainRefs;
    side: 0 | 1;
    amountUsd: number;
    bettor: string;
  }): Promise<{ tokensOut: number; signature: string }> {
    const tokens = await this.entryTokens(params.refs.marketId);
    const token = tokens[params.side];
    const account = this.opts.signerFor(params.bettor);
    const wei = await this.usdToWei(params.amountUsd);

    const before = await this.tokenBalance(token, account.address);
    const hash = await this.wallet(account).writeContract({
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
    });
    await this.pub.waitForTransactionReceipt({ hash });
    const after = await this.tokenBalance(token, account.address);

    // The position, measured rather than assumed. This is the number that was
    // hardcoded to 0 on Solana, where it lived in an ATA the swap never
    // reported back and every token-weighted figure quietly divided by it.
    const tokensOut = after - before;
    if (tokensOut <= 0n) throw new Error(`bet landed (${hash}) but yielded no tokens`);
    return { tokensOut: Number(tokensOut), signature: hash };
  }

  /**
   * Quote by SIMULATING the swap, never by dividing pot totals. Entry is
   * curve-priced, so tokensOut is the unit of payout and a linear pot-share
   * approximation overstates large stakes.
   */
  async previewStake(params: {
    refs: ChainRefs;
    side: 0 | 1;
    amountUsd: number;
  }): Promise<{ tokensOut: number; feeUsd: number }> {
    const tokens = await this.entryTokens(params.refs.marketId);
    const wei = await this.usdToWei(params.amountUsd);

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

  async settle(params: { refs: ChainRefs; winner: 0 | 1 }): Promise<void> {
    const { operator, addresses } = this.opts;
    const oracle = await this.oracleAddress(params.refs.marketId);
    const wallet = this.wallet(operator);

    // The verdict. Terminal, and the migrator reads it exactly once.
    const hash = await wallet.writeContract({
      address: oracle,
      abi: ratioOracleAbi,
      functionName: "declareWinner",
      args: [params.winner, 0n, 0n, false],
      chain: baseSepolia,
      account: operator,
    });
    await this.pub.waitForTransactionReceipt({ hash });

    // Migration is a separate step on EVM: Airlock moves each entry's proceeds
    // into the pot, and claims revert until the WINNING entry has migrated.
    for (const token of await this.entryTokens(params.refs.marketId)) {
      const m = await wallet.writeContract({
        address: addresses.airlock,
        abi: airlockAbi,
        functionName: "migrate",
        args: [token],
        chain: baseSepolia,
        account: operator,
      });
      await this.pub.waitForTransactionReceipt({ hash: m });
    }
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

    const wallet = this.wallet(account);
    const approve = await wallet.writeContract({
      address: winningToken,
      abi: erc20Abi,
      functionName: "approve",
      args: [addresses.predictionMigrator, held],
      chain: baseSepolia,
      account,
    });
    await this.pub.waitForTransactionReceipt({ hash: approve });

    const claim = await wallet.writeContract({
      address: addresses.predictionMigrator,
      abi: predictionMigratorAbi,
      functionName: "claim",
      args: [oracle, held],
      chain: baseSepolia,
      account,
    });
    await this.pub.waitForTransactionReceipt({ hash: claim });

    return { paidUsd: await this.weiToUsd(payout) };
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
    const hash = await this.wallet(account).sendTransaction({
      to: opts.to as Address,
      value: await this.usdToWei(opts.amountUsd),
      chain: baseSepolia,
      account,
    });
    await this.pub.waitForTransactionReceipt({ hash });
    return { signature: hash };
  }

  isValidAddress(candidate: string): boolean {
    return /^0x[0-9a-fA-F]{40}$/.test(candidate);
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
