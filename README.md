# ratio

A prediction market that lives on X. Someone tweets, someone answers, anyone
tags **@ratiowtf** on the answer: a 24-hour market opens between the two
tweets. Most likes when the clock runs out wins. The likes are the referee.

Built on Doppler, which is Uniswap v4 hooks: each side of a market is a v4
pool, entry is curve-priced, settlement is token-weighted parimutuel. Runs on
**Base Sepolia**. The Solana build it was ported from stays beside it, behind
the same seam.

`ratio.wtf` · repo `github.com/gossipgirlonchain/ratio` · bot **@ratiowtf**

## Judge this in five minutes

ETHOnline 2026, continuity track. What existed before the event and what was
built during it is split honestly in [`WHATS-NEW.md`](WHATS-NEW.md). Every
prompt and decision that shaped the week is in [`prompts/`](prompts/), in order.

1. **The site**: [ratio.wtf](https://ratio.wtf). It is behind a beta wall; the
   access code for judges is **`RATIO-ETHG-2026`**. The feed, market pages,
   leaderboards and profiles read their money from The Graph, and each market
   says which source answered.
2. **A market that was paid out, end to end, by the engine** on Base Sepolia:
   market `7676262`, oracle-resolved, both entries migrated, winner claimed
   $4.47 of a $4.51 pot. Read it straight from the index:

   ```bash
   curl -s -X POST https://api.studio.thegraph.com/query/1758972/ratio/version/latest \
     -H 'content-type: application/json' \
     -d '{"query":"{ markets(where:{marketId:\"7676262\"}) { resolved winnerSide totalPot totalClaimed claims { claimer payout } } }"}'
   ```
3. **The one contract we wrote**, with 29 Foundry tests including a fork
   against the live Doppler deployment: `cd contracts && forge test`.
4. **A curve quote**, live: `POST https://ratio.wtf/api/quote` with
   `{"marketId":"<id>","side":0,"stakeUsd":25}` simulates the v4 swap and
   returns the token share of the projected pot. `$1`, `$25` and `$500` on the
   same side come back at different multiples, which is the point.
5. **The friction**, written as it was hit: [`FEEDBACK.md`](FEEDBACK.md).

The three partner integrations, and where each one actually lives, are below.

## EVM (ETHOnline 2026)

Ratio runs on Base Sepolia against Doppler's `PredictionMigrator`, which prices
entry through Uniswap v4 pools and pays token-weighted parimutuel claims.
Addresses and how to re-verify them: `contracts/BASE-SEPOLIA.md`. The event
schema the subgraph is built against: `contracts/EVENTS.md`.

We own exactly one contract, `RatioOracle` — it reports the 24h likes verdict
and refuses to report it wrongly. Everything else is Doppler's.

```bash
cd contracts && forge test          # 29 tests: unit + forked against live state
```

### For judges: what to look at, and where

Uniswap Foundation asks that the README identify the relevant contracts and
code lines. The Uniswap surface here is Doppler, which is Uniswap v4 hooks —
each market is two v4 pools, and entry pricing is entirely theirs.

| What | Where |
|---|---|
| The one contract we wrote | [`contracts/src/RatioOracle.sol`](contracts/src/RatioOracle.sol) — implements `IPredictionOracle`, reports the 24h likes verdict, refuses to report it twice or early |
| One oracle per market | [`contracts/src/RatioOracleFactory.sol`](contracts/src/RatioOracleFactory.sol) — EIP-1167 clones, CREATE2-salted on the tweet id |
| v4 pool construction | [`packages/chain/src/evm/index.ts`](packages/chain/src/evm/index.ts) `createEntry` — `airlock.create` per side, `farTick == startTick` so migration is oracle-gated rather than price-gated |
| The bet, as a v4 swap | [`packages/chain/src/evm/index.ts`](packages/chain/src/evm/index.ts) `placeBet` / `poolKey` |
| Quotes from simulation, not pot totals | [`packages/chain/src/evm/index.ts`](packages/chain/src/evm/index.ts) `previewStake` |
| Doppler's fee-split rules | [`packages/chain/src/evm/beneficiaries.ts`](packages/chain/src/evm/beneficiaries.ts) + tests |
| Proof it works, against live deployed code | [`contracts/test/BaseSepoliaLifecycle.t.sol`](contracts/test/BaseSepoliaLifecycle.t.sol) — forks Base Sepolia |
| One real market, end to end, from a forge script | [`contracts/BASE-SEPOLIA.md`](contracts/BASE-SEPOLIA.md) — 13 transactions with hashes |
| The same lifecycle driven by the ENGINE, against the live chain | [`apps/agent/src/sim-evm.ts`](apps/agent/src/sim-evm.ts) — `npm run sim:evm:live -w @ratio/agent`; market `7676262` was created, staked, resolved, migrated and claimed this way |
| Settlement and claim: `declareWinner` → `migrate` per entry → `claim` | [`packages/chain/src/evm/index.ts`](packages/chain/src/evm/index.ts) `settle` / `claimFor` — each step is confirmed by a READ, not a receipt, because a load-balanced RPC stranded a pot when it was not |
| Did the money actually move? | [`apps/agent/scripts/migration-audit.ts`](apps/agent/scripts/migration-audit.ts) and [`claim-audit.ts`](apps/agent/scripts/claim-audit.ts) — the scripts that found the stranded markets |
| Friction we hit | [`FEEDBACK.md`](FEEDBACK.md) |

The thing most worth a judge's attention: Doppler's EVM prediction market
(`PredictionMigrator`, `NoSellDopplerHook`) is deployed and whitelisted on Base
Sepolia but exists only on an unmerged PR, and appears in no documentation, SDK
or indexer. **Ratio is its first transaction ever** — it had processed none
between February and us. Two wiring bugs that block any integrator are written
up with call traces in `FEEDBACK.md` section 2.

### The Graph

The subgraph is not decoration: on chain there are no entry prices and no trade
history, because the pools drain at migration and Uniswap v4 is a singleton.
Per-side stake is a sum over swaps or it does not exist.

| What | Where |
|---|---|
| Schema and mappings | [`subgraph/`](subgraph/) |
| Attribution: how a swap finds its market | [`subgraph/src/migrator.ts`](subgraph/src/migrator.ts) — an indexed `PoolKey` arrives hashed, so we index *forward* and record the `poolId` at registration |
| The bettor is `transaction.from`, not `Swap.sender` | [`subgraph/src/swaps.ts`](subgraph/src/swaps.ts) — `sender` is the router; using it attributes every bet to one address |
| The agent consuming it | [`packages/chain/src/evm/subgraph.ts`](packages/chain/src/evm/subgraph.ts), wired at [`apps/agent/src/assembleChain.ts`](apps/agent/src/assembleChain.ts) `raisedWeiFor` |
| The app consuming it | [`apps/web/lib/subgraph.ts`](apps/web/lib/subgraph.ts) and [`apps/web/app/api/markets/route.ts`](apps/web/app/api/markets/route.ts) — the join: X data from our store, money from the index, keyed on the side-B tweet id |
| Live endpoint | `https://api.studio.thegraph.com/query/1758972/ratio/version/latest` |

Query it directly:

```bash
curl -s -X POST https://api.studio.thegraph.com/query/1758972/ratio/version/latest \
  -H 'content-type: application/json' \
  -d '{"query":"{ protocol(id: \"0x726174696f\") { marketCount tradeCount totalStaked } }"}'
```

Every money number in the product is a read from this. The app says which
source answered, per market: a market opened on Solana, or one the index has
never seen, reports `"store"` and is served from our own bet records, which can
only see bets we brokered.

### Privy

Auth is X login only, and the Privy embedded wallet is the only wallet. There
is no connect-wallet button and there never will be; users fund by transferring
in. The financial flow is placing a bet: a transfer out of a Privy server
wallet into a Uniswap v4 pool, signed server-side for a user who has never
seen a seed phrase.

| What | Where |
|---|---|
| Server wallets keyed to the numeric X id, one per person per chain | [`apps/agent/src/privyWalletsEvm.ts`](apps/agent/src/privyWalletsEvm.ts) — `@privy-io/node`, idempotency key `ratio-evm-wallet-${xUserId}`, namespaced rather than migrated from the Solana wallets |
| The bet, signed by that wallet | [`packages/chain/src/evm/index.ts`](packages/chain/src/evm/index.ts) `placeBet` — the account comes from `signerFor(bettor)`, which resolves to the Privy signer |
| Fee recipients get a wallet before they ever log in | [`apps/agent/src/engine.ts`](apps/agent/src/engine.ts) `createMarket` — both authors and the tagger are provisioned at market creation so fees accrue to them from the first trade |
| X login on the client | [`apps/web/lib/auth.ts`](apps/web/lib/auth.ts) — `@privy-io/react-auth`, X as the only login method |


### The operator key is testnet-only

`BASE_SEPOLIA_PRIVATE_KEY` is the agent's operator key: it deploys the oracle
factory, opens markets, and relays verdicts. On testnet the smoke-test signer and
the operator are deliberately the same key.

**It must never be reused on mainnet.** Mainnet needs a fresh key held somewhere
that is not a developer's `.env` — the operator can open markets and declare
winners, so a leak there is a leak of settlement authority, not just funds.
`.env` is gitignored and has never been committed; `contracts/.env.example`
records the shape without the value.

Generate the key with the helper rather than by hand — it writes straight to
`contracts/.env` (mode 600) and prints only the address, so the private key
never reaches a terminal, a shell history, or a chat window:

```bash
cd contracts && ./new-operator-key.sh
```

To run one real market end to end and get block-explorer links:

```bash
cd contracts
forge script script/LifecycleBaseSepolia.s.sol:LifecycleBaseSepolia \
  --rpc-url https://sepolia.base.org --skip-simulation --broadcast -vvv
```

The key goes in `contracts/.env`, not the repo root — foundry loads `.env` from
the directory you run in. It is gitignored at any depth.

`--skip-simulation` is required: foundry's post-run replay fails on Base Sepolia
with `invalid fee token: 0x20C0…`, an OP-stack custom-gas-token path this build
mishandles. It is the replay that breaks, not the script, and the forked test
covers what the replay would have checked.

## Before the event: the Solana build (pre-4 September, not judged)

The R1–R5 log of the Solana product this was ported from. Kept because the
rules, the seams and the sim all carry over; none of it is event work.

- **R1 — done.** Eligibility gate, pair resolution (QT + reply, one code
  path), market creation, 24h settlement on absolute like counts, tie to
  side A. All against mocks: `npm run sim`.
- **R2 — done, then superseded (2026-08-11): voids are DELETED.** No void
  status, no void reasons, no refund path (none exists on-chain anyway —
  the prediction hook rejects every sell and the IDLs have no
  cancel/refund instruction, so a voided market would strand funds).
  Instead: every market is seeded `SEED_PER_SIDE_USD` ($1) per side from
  the treasury at creation, before the card posts — ZeroClaimableSupply
  becomes an unreachable invariant (logged loudly, never a settle path) —
  and an unreadable side (deleted / private / suspended) settles as a
  FORFEIT for the surviving side (both gone → side A by tie convention).
  Seeds are plumbing: excluded from `listBets`, participant displays, and
  the who's-in list. Transient-vs-gone distinction survives: API failures
  still defer and retry; only definitive unreadability forfeits. The
  mid-window health check was repurposed, not deleted: it is now the
  likes sampler (`LIKES_SAMPLE_INTERVAL_MS`), recording per-side like
  counts for open markets — the chart's likes series, which exists
  nowhere else and cannot be backfilled. Sells are disabled
  (`SELLS_ENABLED=false`, devnet-proven hook rejection); the exit-fee
  ramp is shelved in config, not deleted.
- **Hidden-reply badge — done (agent side).** The extension reports side B
  missing from its thread; at `HIDDEN_REPORT_THRESHOLD` independent
  reporters the badge goes live and the bot posts once ("this reply is no
  longer showing in the thread. the market is still open."). Display flag
  ONLY — settlement stays pure like counts. Observation-worded, never names
  the hider. This is a feature, not an error state: the market page and
  extension surface hidden markets prominently (R5), routing likes to the
  suppressed reply. It is also the extension's install driver — the
  extension is the only thing that can see a hide.
- **Folded ahead of R3 (2026-07-31):** fees locked (1.25% swap fee, five
  immutable beneficiaries: doppler 7.5 / treasury 45 / A 18 / B 18 / tagger
  11.5); own-post rule (tagger can never be side A's author; tagger as side
  B's author is allowed and stacks slices); duplicate pairs convert with a
  direct market link instead of a bare rejection; post view indexed on
  `tweet_a_id` with a HARD no-cross-market-aggregation rule (count is a
  count, never a score); trending ranks on staked volume, never market
  count. Odds displays derive from pot shares (no continuous curve price in
  a parimutuel market).
- **R3 — devnet lifecycle PROVEN (2026-07-31).** `@ratio/doppler`
  (`RatioMarketClient`, doppler-sdk 1.0.34): oracle + A/B curves with FIVE
  fee beneficiaries at the locked split → stakes both sides → finalize(A)
  → migrate → claim. Pot = staked − 1.25% exactly (0.1086 of 0.11 SOL),
  winner multiple 1.358x.
- **R3 tail — engine on the real chain (2026-08-03).** `sim:devnet` runs
  the actual `RatioEngine` (fake X) against `DopplerMarketChain` +
  `LocalWalletProvider` (Privy stand-in behind the same seam): mention →
  five-beneficiary launch → two real reply-stake swaps → finalize →
  migrate, all through the engine's own code path. Accounting fact learned:
  the pre-migration odds snapshot (quote vaults) is GROSS staked volume;
  the fee is realized at migration, so claimable pot = snapshot − 1.25%.
  Display and fee-card code must not conflate the two. Mock tweet ids are
  wall-clock-seeded in the devnet sim (ids become oracle nonces; reused
  nonces collide with prior runs' PDAs).
- **UI spec landed (2026-08-03); strip v2 after winny's review.**
  `packages/ui` MarketStrip = the canonical component (extension strip is
  the reference; app mirrors it via host variables + `apps/web` skin.css —
  never fork the component for a skin). v2 layout: both tweets are sibling
  rows with identical treatment (the OP is a competitor, not context);
  like counts 13px at the right of each row; the leader is a shaded row
  with a bold count and nothing else; zero ? hints; ONE line of copy
  ("most likes in <time> wins" / "@x won" / "@x wins by forfeit");
  12-13px throughout; tap a row to back someone; the amount grid appears
  only after a pick, swapping with the whole body in one grid cell (no
  reserved dead space, height provably constant). One strip one market (no
  aggregate state, ever); money demoted below the divider as pot shares;
  no status vocabulary anywhere; parimutuel quote with dilution surfaced
  (payout.ts documents the spec-example discrepancy + the plan to quote
  from the chain's preview swap); hidden badge is a story beat and the
  market stays bettable. Funding (§11) goes behind FundingProvider in R4.
- **Reply surface is §4-clean (2026-08-03).** Stakes are handle-based
  ("$25 @handle", "@handle $25", "$25 on @handle"); A/B letters remain a
  silent parser fallback. Unresolvable handles fail safe (skip, no reply
  spend). Bot confirms and recaps name people, never sides. Also landed:
  `feeLeaderboard` store query (one combined board ranked on total fees,
  per-role breakdown per row, rolling windows keyed on bet timestamps) and
  the `FundingMethod` seam (`@ratio/config/funding`).
- **Site architecture specced (2026-08-03, R5 scope)** — see winny's doc.
  Store hardened NOW so the schema can carry it: trade records gained
  `direction` (buy/sell — the chart's only time series, unbackfillable),
  plus `listMarketsByParticipant` (profiles exist for every account that
  ever touched a market, no opt-out), `listMarketsByVolume` (feed ranks by
  windowed staked volume; settled markets drop off), and
  `openPositionsByUser` (net of sells; average entry only exists in our
  records). Key page decisions: profile IS the claim page (no separate
  dashboard, public unclaimed balances are the acquisition hook); exits
  live on the market page only, never the extension strip; extension
  collapsed bar shows count + volume ONLY (no aggregate outcome state);
  posts without markets get a hover-only create preview in X's action
  row; OG unfurl images are their own workstream sharing infra with
  settlement fee cards.
- **R4.** Privy server wallets keyed on numeric X id, ATA creation in the
  sponsored-gas path, unclaimed-fee notifications.
- **R5.** PWA -> extension -> Telegram.
- **Scanner — in-app panel BUILT (2026-08-14, pulled forward).** KNOB
  rule builder docked to the rail column on every page (module-level
  state survives navigation): explicit mode + number controls for the
  seven AND-able conditions, generated summary before save (chat/parser
  version built first, reversed same day: knobs, not qualitative), fire-once per rule per market on the likes-sampler cadence,
  alerts lead with the market + bet link, presets as prompts, logged-out
  point-of-action gate, rules/alerts/alert-led-bets instrumented
  (localStorage ratio-scanner-v1). Spec: docs/scanner-spec.md. Still
  pending: server-side evaluation, extension push, Telegram. NO
  auto-execution without its own workstream.
- **Backlog (ordered): extension -> OG images.**

## Layout

- `apps/agent` — mention loop, engine, settlement + likes-sampler crons, sims
- `apps/web` — the app: feed, market page, profiles, boards, access gate
- `packages/chain` — the `MarketChain` seam, with `solana/` and `evm/` beside
  each other; `evm/subgraph.ts` is the index client
- `packages/config` — every knob and every copy template (handle-parameterized)
- `packages/doppler` — `RatioMarketClient` on doppler-sol (prediction
  migrator); `npm run e2e -w @ratio/doppler` runs the devnet lifecycle
- `packages/ui` — `MarketStrip`, the one component the app and the extension
  share
- `contracts` — `RatioOracle` and its factory, plus Foundry tests
- `subgraph` — schema and mappings

Seams (all swappable, engine never knows): `XClient`, `WalletProvider`,
`Store`, `MarketChain`.

## Written with AI

Effectively all of the code in this repository was written by Claude (Anthropic)
in Claude Code, working from written direction. Rather than mark it file by file
when the answer would be the same line on every file, the honest split is by
kind of work:

**Written by Claude, reviewed and directed by a human**: everything under
`apps/`, `packages/`, `contracts/src`, `contracts/test` and `subgraph/`. That
includes the Solidity, the subgraph mappings, the engine, the app, and the
tests.

**Human, and not AI-generated**: the product itself. The mechanic, the rules
that decide markets, the fee split and its weights, the design direction and
the copy voice, the call to write our own settlement layer rather than pay out
from a treasury, and every decision recorded in [`prompts/`](prompts/). The
prompts in that directory are verbatim human writing and are the clearest
picture of which half is which.

**Found by the human, fixed by Claude**: several of the bugs recorded in
[`WHATS-NEW.md`](WHATS-NEW.md), including the one where a reply that never
tagged the bot opened a market.

**Third-party**: Doppler's contracts and SDK, Uniswap v4 core, Privy, Supabase,
The Graph tooling. None of it is ours and none of it is AI-generated by us.
