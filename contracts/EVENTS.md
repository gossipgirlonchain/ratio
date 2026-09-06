# Event schema — what the subgraph indexes

**Rewritten 2026-09-06, replacing the speculative schema frozen earlier the same
day.** That version described events for a settlement contract we were going to
write. We are not writing one: Doppler's `PredictionMigrator` is deployed and
whitelisted on Base Sepolia (see `BASE-SEPOLIA.md`), so the events below are
**real, already deployed, and verified against on-chain bytecode** rather than
designed by us.

Every topic0 here was confirmed present in the deployed runtime bytecode of the
contract that emits it. None of this is guesswork.

## Architecture, in one paragraph

Doppler prices entry: one Uniswap v4 pool per side, curve-priced, with
`NoSellDopplerHook` making positions one-way. `PredictionMigrator` holds the pot
and pays claims. We supply exactly one contract — `RatioOracle`, implementing
`IPredictionOracle` — which reports the winner after the 24h likes verdict. The
agent is its only writer, the same trust model as Solana.

## Identity mapping

| Ratio concept | On-chain |
|---|---|
| A market | One `RatioOracle` instance. `PredictionMigrator` keys markets by **oracle address** (`_markets[oracle]`), so one market means one oracle contract. Deployed as an EIP-1167 minimal proxy per market. |
| Market id (side B's tweet id) | Stored on the oracle and emitted by us at creation; the migrator never sees it. |
| Side A / side B | `entryId` = `bytes32(uint256(0))` and `bytes32(uint256(1))`. The migrator only requires uniqueness within a market, so the side index **is** the entry id. |
| A side's token | The DERC20 minted by the entry's launch. Must support `burn(uint256)` or `migrate` reverts. |
| The pot | `market.totalPot` on the migrator, in the shared numeraire. |
| A bet | A swap on that side's v4 pool. |

## Events we index

### `PredictionMigrator` — `0x91aad599EfD70E633d091FC060cc6f9D3e5298BE`

```solidity
event EntryRegistered(
    address indexed oracle,
    bytes32 indexed entryId,
    address token,
    address numeraire
);
// topic0 0xf1c9c9c40614762e48ef0d778e98d0e8c6e8301e00115dd327158124b7780577

event EntryMigrated(
    address indexed oracle,
    bytes32 indexed entryId,
    address token,
    uint256 contribution,      // numeraire added to the pot
    uint256 claimableSupply    // totalSupply - unsold, the payout denominator
);
// topic0 0x26fbd82cf8c1fd663dd9930dc48978118f5e028fb7fb7bcc08ec0d869f3005d3

event Claimed(
    address indexed oracle,
    address indexed claimer,
    uint256 tokensBurned,
    uint256 numeraireReceived
);
// topic0 0x2f6639d24651730c7bf57c95ddbf96d66d11477e4ec626876f92c22e5f365e68
```

### `DopplerHookInitializer` — `0xAA096F558f3d4c9226De77E7Cc05f18E180B2544`

This is where trades live. The initializer emits its own `Swap` from `afterSwap`,
which is richer than the raw PoolManager event.

```solidity
event Swap(
    address indexed sender,          // the ROUTER, not the bettor — see below
    PoolKey indexed poolKey,
    PoolId  indexed poolId,
    IPoolManager.SwapParams params,
    int128  amount0,
    int128  amount1,
    bytes   hookData
);
// topic0 0x1d9f7b5e406d8c887155e1a78e070d2d41c5d0444dab8b21612f846835c27183

event Graduate(address indexed asset);
// topic0 0xbd2bd570c963e5fe6bdc6422e5741c710099e75c6d44b6c73e6acc397429bdf7
```

### `RatioOracle` — ours, one per market

```solidity
/// From IPredictionOracle. The migrator reads getWinner(); this is the log.
event WinnerDeclared(address indexed oracle, address indexed winningToken);

/// Ours. The migrator has no idea what a tweet is, so this is the only place
/// the chain records which market this oracle represents.
event MarketOpened(
    address indexed oracle,
    uint256 indexed marketId,        // side B's tweet id
    address tokenA,
    address tokenB,
    uint64  settlesAt
);
```

## The attribution problem, and how we solve it

**`Swap.sender` is the address that called the PoolManager — a router, not the
person betting.** This is the standard Uniswap v4 indexing trap and it would
silently attribute every bet to one address.

The bettor is `event.transaction.from`, because each bettor's Privy server wallet
signs and sends its own transaction. The subgraph keys positions off that.

**This imposes a real constraint on the product: we cannot use a paymaster or a
relayer for bets.** The moment gas is sponsored by a third party,
`transaction.from` becomes the sponsor and per-user attribution collapses. On
Solana we sponsored ATA rent from the treasury; the EVM equivalent is off the
table unless we add our own router contract that emits a `BetPlaced(bettor, ...)`
of its own. We are not doing that this week. **If sponsored gas ever comes back,
this schema needs the router.**

## Derivations the subgraph performs

| Surface | From | How |
|---|---|---|
| Position (tokens held) | `Swap` | `amount0`/`amount1` — the signed balance deltas give tokens received and numeraire paid, per trade. This is `tokensOut`, and it is why the Solana `tokens_out = 0` bug does not reproduce here. |
| Entry price | `Swap` | `numeraireIn / tokensOut` per trade. Exists nowhere else and cannot be backfilled. |
| Trending by staked volume | `Swap` | net numeraire in per market, windowed on block timestamp. Never market count. |
| Pot | `EntryMigrated` | `sum(contribution)` per oracle, or `market.totalPot` read directly. |
| Payout denominator | `EntryMigrated` | `claimableSupply` on the winning entry. |
| Expected payout | both | `tokens / claimableSupply * totalPot`. |
| Fee leaderboard | `Swap` + beneficiary config | fee is taken on entry at `SWAP_FEE_BPS`; the split is immutable from launch, so accrual derives per role without a per-beneficiary event. |
| Resolution | `WinnerDeclared`, `EntryMigrated` | winner, then the migration that makes claims possible. |
| Realised profit | `Claimed` + `Swap` | `numeraireReceived - sum(numeraire paid)`. |

## What stays in Supabase

Likes and their time series, tweet text, handles, pair type, mention idempotency,
and the wallet map. None of it is chain data and none of it can be indexed. The
market page joins subgraph money against Supabase social.

## Ordering invariants the indexer may assume

1. `EntryRegistered` fires twice per market, once per side, before any `Swap`.
2. `WinnerDeclared` precedes `EntryMigrated`; the migrator reverts with
   `OracleNotFinalized` otherwise.
3. `EntryMigrated` fires at most once per entry (`AlreadyMigrated` guards it).
4. `Claimed` only follows the winning entry's `EntryMigrated`
   (`WinningEntryNotMigrated` guards it).
5. `sum(Claimed.numeraireReceived) <= totalPot`, remainder is integer-division dust.
6. A market with `claimableSupply == 0` on the winning side cannot be claimed —
   `mulDiv` divides by zero and reverts. The $1-per-side treasury seed keeps this
   unreachable, exactly as on Solana.

## Change policy

Adding an event to `RatioOracle` is safe and needs no sign-off. The
`PredictionMigrator` and `DopplerHookInitializer` events are **not ours to
change** — they are deployed. If a mapping needs something they do not emit, the
answer is either a `RatioOracle` event or a router, and that is a conversation.
