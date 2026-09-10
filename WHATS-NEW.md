# What is new

ETHOnline 2026 continuity track. Ratio existed before the event as a Solana
product; only the work done during the event is judged. This file keeps the two
apart honestly — nothing undersold, nothing overclaimed.

**Event window: 4 September 2026 onward.** Work began 6 September.

---

## Existed before 4 September (not judged)

The Solana build. Roughly 15,600 lines across the workspace.

- **The engine** (`apps/agent`). X mention loop, pair resolution for reply and
  quote-tweet shapes through one code path, the eligibility gate (12h freshness,
  no markets on your own post, no self-pairs, duplicate-pair conversion), 24h
  settlement on absolute like counts with ties to side A, forfeit-to-survivor for
  unreadable sides, the likes sampler, and the hidden-reply badge.
- **Four seams**: `MarketChain`, `XClient`, `WalletProvider`, `Store` — with mock
  and production implementations of each.
- **`packages/doppler`**: `RatioMarketClient` over the Doppler Solana SDK, driving
  the prediction-migrator lifecycle (trusted oracle, per-side XYK curves, up to
  five fee beneficiaries, finalize → migrate → claim). Devnet-proven.
- **The store**: Supabase schema and adapter, trending by staked volume, fee and
  trader leaderboards, positions, post views.
- **The web app** (`apps/web`): feed, market page with chart, profile, leaderboard,
  admin, access gate, OG share cards, the market scanner panel.
- **Privy X-login wallets**, server-side, keyed to the numeric X id, provisioned on
  first touch so fee recipients accrue before they ever log in.
- **The sim**: 18 scenarios against mocks, no network required.

## Built during the event (judged)

### Sunday 6 September

**Recon and decisions.**
- Mapped the chain seam and every place the codebase reached around it, which
  turned out to be most of `apps/web`.
- Chain selected: **Base Sepolia (84532)**, the only chain where Doppler's
  prediction market is deployed. There is no Unichain Sepolia deployment. The
  Uniswap Foundation claim is structural — Doppler pools are v4 hooks — and does
  not depend on the chain.

**Found Doppler's EVM prediction market, already deployed.** Three
documentation searches said EVM had no prediction lifecycle. It does — it is on
an open PR (#481) and deployed to Base Sepolia since February, whitelisted
against the live Airlock, and mentioned nowhere in the docs, the SDK, the
indexer, the API, or `Deployments.json`. Verified by RPC:

- `PredictionMigrator` `0x91aad599EfD70E633d091FC060cc6f9D3e5298BE` — Airlock module state 4
- `NoSellDopplerHook` `0x21588C923de63914cbc624002417c2AA64a15bFe` — hook flags 3
- `MockPredictionOracle` `0xaE92178EE4eDEa87273dbDe36dA015039115d46a`

Zero events had ever been emitted on that migrator. Ratio is its first
integration. Recorded in `contracts/BASE-SEPOLIA.md` with re-verification
commands.

**`contracts/EVENTS.md` — the event schema the subgraph is built against.**
Written first, before any indexer work, so subgraph and contract work run in
parallel. Rewritten once the deployed contracts were found: every event in it is
now real and every topic0 was verified present in the emitting contract's
on-chain runtime bytecode. Two findings came out of reading the real contracts —
per-trade `tokensOut` is available from the initializer's own `Swap` event, and
`Swap.sender` is the router rather than the bettor, which makes sponsored gas
incompatible with per-user attribution.

**`RatioOracle` + `RatioOracleFactory` — the only contract ratio owns on EVM.**
Doppler holds the pot and pays claims; we answer "who won". One EIP-1167 clone
per market, CREATE2-salted on the tweet id so the agent can compute the oracle
address before deploying it. Resolution is agent-only, terminal, cannot land
before `settlesAt`, and cannot land before entry tokens are attached. 21 Foundry
tests including the tie-holds-for-side-A convention and a fuzz over the verdict.

### Sunday 6 September, evening

**The port, behind the seam.** `EvmMarketChain` implements `MarketChain`
against Doppler on Base Sepolia: Airlock creates one curve per side, stakes are
swaps through the v4 router, settlement is `declareWinner` then `migrate` then
`claim`. The Solana implementation sits beside it, untouched. `RATIO_CHAIN=evm`
selects it in both the agent and the web app.

- Doppler's beneficiary array is built from our five-way split, merging shares
  per wallet — the initializer rejects a duplicate beneficiary, and the tagger
  legitimately IS side B's author sometimes, which is why the number is "up to
  five" rather than five.
- Stakes carry their unit: `$25` is a dollar amount and `0.01` is ETH, priced
  straight through with no rate consulted, so a broken price feed cannot move a
  native-denominated stake.
- Privy wallets namespaced rather than migrated (`ratio-evm-wallet-${xUserId}`),
  one wallet per person per chain, on `@privy-io/node`.
- **The subgraph**: markets, entries, pools, trades, positions, claims, users
  and protocol totals, keyed off the frozen event schema. Entry price is
  captured at the moment of the swap because it exists nowhere else.
- The agent reads its odds from the subgraph rather than from its own records:
  a bet placed straight at the contract counts the same as one we brokered.
- First market opened by the engine itself on Base Sepolia, and an EVM sim that
  drives the whole loop against the real chain with a fake X.

### Monday 7 September

Minimum stake $1 to $2. The $1-per-side creation seed removed: the treasury
rescues at settlement only, and only if the winning side is genuinely empty.

### Tuesday 8 September

**The subgraph deployed and syncing**, after two bugs that each aborted it:
`bytes32` side ids decode big-endian (`Bytes.toI32()` reads little-endian and
overflows), and swaps are indexed from the PoolManager rather than the
initializer.

**The app reads its money from the index.** `/api/markets` is now a join: X
data (handles, texts, like counts) from our store, money (pots, entry prices,
trades, chart bars, fee accrual) from the subgraph, keyed on the side-B tweet
id. Every money number folds over one event list, so the chart cannot disagree
with the pot. The payload says which source answered, per market, because a
market opened on Solana has no indexed money however healthy the index is.

**Four bugs found by verifying rather than assuming**, all of them silent:

1. **A mined transaction is not a successful one.** `waitForTransactionReceipt`
   was never checked for `status`, so a reverted transaction read as success
   all the way up. That is how a settlement whose migration reverted still
   marked the market settled — money stranded in a pool, with the store saying
   it had been paid out.
2. **The index lost side 0 of a market.** A dynamic data source does not see
   events from the block it was created in, and the oracle emits `MarketOpened`
   in exactly that block — so the market entity did not exist yet when the
   migrator registered side 0, and the entry was dropped. One side of the money
   vanished while the other indexed normally, which reads as a market nobody
   bet against. The market entity is now created from the factory, which is a
   static source and always runs.
3. **An empty environment variable is not a value.** `vercel env pull` writes
   sensitive vars as `VAR=""`, `??` accepts the empty string, and the bot took
   the handle `""`. It answered to `@`, every mention parsed as noise, and
   nothing was logged because skipping noise is the correct silent path.
4. **Realised profit counted open stakes as losses**, and `wins`/`losses` were
   declared in the schema and never incremented. Every active trader ranked
   below someone who had never bet. Losses now book at resolution, wins at
   claim, net of what the position cost.

**Schema honesty**: `Beneficiary` and `FeeShare` deleted. No event on Base
Sepolia carries the beneficiary addresses, so an indexed accrual could only
ever be empty; fees derive at the read layer from indexed trade amounts and the
immutable shares, and `EVENTS.md` now says so.

**One market real on both sides of the join**: the engine sim can write to
Supabase (`RATIO_SIM_STORE=supabase`), so a run produces a market that exists
in the store and on Base Sepolia at once. The app then shows it with money read
from The Graph.

### Tuesday 9 September

**A live incident, and the rule that was missing.** @Tibug replied `RATIO` to
one of our own posts, tagging nobody, and the armed agent opened a market
between our post and that reply and posted a card for it. Betting was stopped
inside a few minutes; the market carried $1 + $1 of treasury seed and no user
money.

The parser had never required the tag. `CREATE_RE` matched the bare word
"ratio", the mentions timeline hands us every reply to our own posts tagged or
not, and an empty reply created a market too. Fixed, with the exact tweet
pinned as a regression test. Recorded in
[`prompts/02`](prompts/02-live-incident-and-corrections.md), including the
wrong fix that was built first and reverted.

**Solana was still the live chain.** `RATIO_CHAIN` had never been set on
Railway, so the running agent had been on Solana the whole time and the EVM
port existed only in `main`. Set to `evm` on Railway and Vercel with the
subgraph endpoint, and production verified reading its money from the index.

**Quotes come from the curve.** This was the brief's own open bug: the linear
pot-split formula overstates large stakes, and it was the live quote path.
`/api/quote` now simulates the swap on chain for `tokensOut` and takes the token
share of the projected pot, with the token denominator summed from indexed
trades. Measured on a live Base Sepolia market: **$1 quotes 1.56x, $25 quotes
1.06x, $500 quotes 0.99x** — the dilution that is the whole brigading defence,
visible in the number before you sign.

The simulation carries a state override on the caller's balance, because
otherwise a $500 quote fails for insufficient funds and the number a bettor
sees moves with our treasury balance. The approximation survives as the
fallback for markets with no pool to simulate against — fixtures, and markets
opened on Solana — and its test now says so instead of asserting it as correct.

**The web app's odds come from the index too.** The trade panel had been
pricing off our own `bets` table while the feed beside it showed indexed
totals.

**A market that can be looked at.** `RATIO_SIM_OPEN_ONLY=1` with a longer
duration leaves a real Base Sepolia market open instead of settling it 90
seconds later, so the product can be used against live indexed money.

**The spine closes: a winner was paid.** The engine drove a market on Base
Sepolia from a tag to a claim — created, both sides staked, resolved on likes,
both entries migrated, and the winning holder paid **$4.47** out of a $4.51 pot
(market `7676262`, verified in the index: `totalClaimed` equals `totalPot` to
within dust).

Getting there took three fixes, and all three are the same bug wearing
different clothes — a confirmed write is not a readable one, because a
load-balanced RPC answers the next call from whichever node it likes:

1. `migrate` reverted because the oracle it asked still said nobody had won,
   moments after `declareWinner` had confirmed. Settlement now reads the
   verdict back before migrating.
2. `claim` reverted with `TRANSFER_FROM_FAILED` because the approve it depended
   on was not visible yet. The claim now waits for the allowance it needs
   rather than for a receipt.
3. The payout was reported to the winner as **$0.00** on a claim that paid
   them, because the preview was taken from a node that had not seen the
   migration. What was paid is now read from the claim's own receipt.

Together with the earlier receipt-status fix, that is the whole class: never
trust a receipt as proof that the next call will see the state it created.

### Still to come

The subgraph redeploy that recovers the dropped side, and the fee leaderboard
rendered from indexed fees.

---

## Honest notes

- The 18-scenario sim, the engine's rules, and the Supabase schema are **pre-event
  work**. The EVM port reuses them; it did not write them.
- `tokens_out` has always been recorded as `0` in production on Solana, because
  the position lands in an associated token account the swap never reports back.
  Every token-weighted number in the product was therefore correct in the sim and
  empty in production. On EVM the value is carried in the initializer's `Swap`
  event, so the subgraph recovers it. This is a fix to a pre-existing bug, not a
  new feature, and it is the indexer that fixes it rather than anything we wrote.
- The Solana implementation is not deleted. It stays beside the EVM one.
