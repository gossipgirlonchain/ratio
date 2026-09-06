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
- Established that Doppler's prediction lifecycle — trusted oracle, oracle-gated
  migration, pro-rata claim — **exists on Solana only**. EVM ships Airlock,
  initializers, migrators and `dopplerLaunchHookV1`, with no oracle-resolved
  prediction module and no prediction example. This is why the week is a port
  *plus* a settlement contract rather than a port.
- Chain selected: **Base Sepolia (84532)**, Doppler's only EVM testnet deployment.
  There is no Unichain Sepolia Doppler deployment. The Uniswap Foundation claim is
  structural (Doppler pools are v4 hooks) and does not depend on the chain.

**`contracts/EVENTS.md` — the frozen event schema.** Six events designed and
published *before* the contract body, so subgraph work and contract work can run
in parallel instead of serialised behind each other. Documents what each product
surface reads, the derivations the indexer performs, and the invariants it may
assume.

**Series 1: the chain seam now actually covers the codebase.** Before this, the
abstraction covered the agent and nothing else — `apps/web` had a second,
parallel chain stack that built swaps and transfers directly against
`@solana/kit` and `RatioMarketClient`, so a chain swap would have meant rewriting
the money path twice.

- `MarketChain` gained the reads and writes that were leaking around it:
  `balanceUsd` (was injected into `EngineConfig` as an RPC closure),
  `reservedUsd`, `transferUsd`, `isValidAddress`.
- `packages/chain` extracted from `apps/agent`, so the web can reach the seam
  without one app importing another. Interface and mock at the root entry, the
  Solana implementation at `./solana`, the EVM one landing beside it as `./evm`.
- `apps/web` rewired onto it. `lib/chain.ts` is now the only file in the web app
  that names a chain; `betServer.ts` went from 106 lines to 71 with none of them
  chain-shaped; `walletServer.ts` holds Privy identity and nothing else.
- `placeBet` returns its transaction signature — the seam had been dropping it,
  and the client treats a falsy signature as a failed bet.
- `LAMPORTS_PER_USD` renamed out of the chain-neutral config package.

**Cut**: `apps/teaser`, 1,100 lines of isolated mock-data marketing site.

### Still to come

Contract, EVM `MarketChain`, subgraph, quote correctness, Privy EVM wallets.
Listed here only when they land.

---

## Honest notes

- The 18-scenario sim, the engine's rules, and the Supabase schema are **pre-event
  work**. The EVM port reuses them; it did not write them.
- `tokens_out` has always been recorded as `0` in production on Solana, because
  the position lands in an associated token account the swap never reports back.
  Every token-weighted number in the product was therefore correct in the sim and
  empty in production. The EVM settlement contract fixes this by construction; it
  is a real fix, and it is a fix to a pre-existing bug rather than a new feature.
- The Solana implementation is not deleted. It stays beside the EVM one.
