# Ratio settlement layer — event schema

**Status: FROZEN 2026-09-06.** Changes after Tuesday 8 September need winny's
sign-off first. The subgraph is built against this document, not against the
contract source, so that indexer work and contract work can run in parallel
without either blocking the other.

## Why this document exists first

The Graph is our largest prize and the subgraph cannot start until events exist.
Writing the contract body first would serialise a week we do not have. So the
event surface is designed, frozen, and published before a line of Solidity is
written; `subgraph/` and `contracts/` then proceed against the same fixed
contract.

## What the contract is

Doppler's prediction lifecycle (trusted oracle → `finalize(winner)` → migrate →
claim) exists on Solana only. On EVM, Doppler ships Airlock, initializers and
migrators, but no oracle-resolved prediction module. So Doppler prices entry —
one XYK curve per side, `previewSwapExactIn` for quotes — and **we own resolution
and payout**.

`RatioMarket` escrows both curves' net quote proceeds, records each bettor's
outcome-token position at purchase time, and pays a token-weighted parimutuel
claim after a trusted oracle finalizes the winner:

```
payout = yourTokens / claimableSupply * netPot        netPot = gross * 0.9875
```

The oracle is the agent's hot wallet — the same trust model as the Solana build.
No decentralised resolution scheme this week.

## A note on positions, and the bug this fixes

On Solana, `tokensOut` was never captured: both `DopplerMarketChain.placeBet` and
the web `placeRealBet` record `0`, because the token amount lived in the bettor's
associated token account and nothing read it back. Every token-weighted number in
the product — trader leaderboard, open positions, payout share — silently divided
by zero-filled data in production while passing in the sim.

Because `RatioMarket` is the contract that takes the position, it knows the token
count by construction. `BetPlaced.tokensOut` is that number, and it is the
authoritative source for every downstream surface.

## Frozen event signatures

```solidity
/// Market opened. marketId is side B's tweet id, the same value used as the
/// Doppler nonce, so a market is addressable from a tweet with no lookup.
event MarketCreated(
    uint256 indexed marketId,
    address indexed oracle,        // trusted resolver: the agent hot wallet
    address indexed creator,       // who paid to open it (agent operator)
    address quoteToken,
    address outcomeTokenA,         // Doppler curve base token, side A
    address outcomeTokenB,
    address curveA,                // Doppler pool/hook, side A
    address curveB,
    uint64  settlesAt,             // createdAt + 24h, seconds
    uint16  swapFeeBps             // 125
);

/// The fee split, immutable from this point. Emitted once, immediately after
/// MarketCreated, in the same transaction.
///
/// LOGICAL roles, not deduplicated: when the tagger is also side B's author the
/// same wallet appears twice, with its two shares. The contract merges
/// duplicates internally for transfer efficiency; the event keeps them apart so
/// the fee leaderboard can attribute per role. Always 5 entries.
event FeeBeneficiariesSet(
    uint256 indexed marketId,
    address[5] wallets,
    uint16[5]  shareBps,           // sums to 10_000
    uint8[5]   roles               // Role enum below
);

/// One entry. Buys only — sells are not supported (see "Sells" below).
///
/// isSeed marks the $1-per-side treasury seed placed before the market card
/// posts. Seeds are plumbing: excluded from participant lists, who's-in and
/// positions, but counted in pot totals and in claimableSupply, because they
/// hold real tokens and dilute payouts like anyone else.
event BetPlaced(
    uint256 indexed marketId,
    address indexed bettor,
    uint8   indexed side,          // 0 = A, 1 = B
    uint256 amountIn,              // gross quote in
    uint256 feeAmount,             // amountIn * swapFeeBps / 10_000
    uint256 netAmount,             // amountIn - feeAmount, escrowed to the pot
    uint256 tokensOut,             // position taken. never zero. see above
    bool    isSeed
);

/// Oracle resolved the market. Terminal: a market is finalized exactly once.
///
/// forfeit = a side was unreadable at settlement (deleted, suspended, private,
/// blocked). Nobody deletes their way out of losing, so the surviving side
/// takes it. Both unreadable resolves to side A, the same convention as an
/// exact tie. There is no void status and no refund path.
event MarketFinalized(
    uint256 indexed marketId,
    uint8   indexed winner,        // 0 = A, 1 = B
    uint256 netPot,                // total claimable, gross * 0.9875
    uint256 claimableSupply,       // winning-side tokens outstanding
    bool    forfeit
);

/// A winner burned their position for their share of the pot.
event Claimed(
    uint256 indexed marketId,
    address indexed claimer,
    uint256 tokensBurned,
    uint256 payout
);

/// Fee withdrawn by a beneficiary. Accrual is derived (see below); this fires
/// only on actual withdrawal, so the leaderboard can show earned vs collected.
event FeesWithdrawn(
    uint256 indexed marketId,
    address indexed beneficiary,
    uint256 amount
);

enum Role { Doppler, Protocol, SideA, SideB, Tagger }   // 0..4
```

## Deliberate omissions, and why

**No `at`/timestamp field on any event.** Subgraph mappings get
`event.block.timestamp` for free. Emitting a timestamp would be a per-bet gas
cost for a value the indexer already has. Every time series in this product —
the chart, rolling fee windows, trending windows — uses block timestamp.

**No fee-accrual event per beneficiary per bet.** That would be five events on
every bet. The split is immutable from `FeeBeneficiariesSet`, so the subgraph
derives each beneficiary's accrual exactly from `BetPlaced.feeAmount`:

```
accrual[wallet] += feeAmount * shareBps[i] / 10_000
```

Cheaper on chain, exact off chain. `FeesWithdrawn` covers the one thing that
cannot be derived — whether the money has actually been taken.

**No likes, tweet text, handles, or pair type.** Those are X data, not chain
data, and they cannot be indexed from events. They stay in Supabase and are
joined at the read layer. The subgraph owns money and positions; Supabase owns
the social record and the likes time series.

**No sell event.** `SELLS_ENABLED = false`. On Solana this is a hard protocol
constraint — the prediction hook rejects sells in every oracle state, confirmed
by devnet proof and by the Doppler team. Our own EVM contract could lift it, and
that is noted in `FEEDBACK.md` as something the EVM path unlocks, but we are not
building it this week. Positions are locked from purchase to settlement and fees
accrue on entry only.

**No void event.** Voids were deleted from the product on 2026-08-11 and stay
deleted. The $1-per-side treasury seed guarantees a real holder on each side, so
a winning side with no money — `claimableSupply == 0` — is unreachable by
construction. The contract still reverts on it rather than dividing by zero; that
is an invariant assertion, not a settlement path.

## What each surface reads

| Surface | Events | Derivation |
|---|---|---|
| Trending, ranked by staked volume | `BetPlaced` | net staked per market, windowed by block timestamp. Never market count — tagging is free, counts inflate, volume cannot be faked without spending. |
| Fee leaderboard | `FeeBeneficiariesSet`, `BetPlaced`, `FeesWithdrawn` | `feeAmount * shareBps / 10_000` per role. One combined board ranked on total earned, per-role breakdown underneath. |
| Market page chart (money series) | `BetPlaced` | entry price = `netAmount / tokensOut`. This series exists nowhere else and cannot be backfilled. |
| Open positions, profile | `BetPlaced`, `Claimed` | tokens held per market per side. |
| Trader leaderboard | `BetPlaced`, `MarketFinalized`, `Claimed` | realised profit = `payout - sum(amountIn)`; seeds excluded from rows, included in `claimableSupply`. |
| Market resolution | `MarketFinalized` | winner, netPot, forfeit flag. |

## Invariants the indexer may assume

1. `MarketCreated` and `FeeBeneficiariesSet` are emitted in the same transaction,
   creation first.
2. `shareBps` sums to exactly `10_000`.
3. `BetPlaced.tokensOut > 0` always. A swap returning zero tokens reverts.
4. `BetPlaced.netAmount == amountIn - feeAmount`.
5. `MarketFinalized` fires at most once per market, and never before `settlesAt`.
6. `Claimed` only ever follows `MarketFinalized` for that market.
7. `sum(Claimed.payout) <= MarketFinalized.netPot`, with the remainder being
   claim dust from integer division.
8. `marketId` is stable and unique: it is side B's tweet id.

## Change policy

Frozen as of 2026-09-06. Adding a **new** event is safe and does not require
sign-off — it cannot break an existing mapping. Changing or reordering the
parameters of an event listed above changes its topic0 or its ABI decoding and
silently breaks the deployed subgraph, so it needs winny's sign-off, and after
Tuesday 8 September it needs a good reason as well.
