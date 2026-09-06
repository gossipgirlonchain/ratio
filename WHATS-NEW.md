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
  empty in production. On EVM the value is carried in the initializer's `Swap`
  event, so the subgraph recovers it. This is a fix to a pre-existing bug, not a
  new feature, and it is the indexer that fixes it rather than anything we wrote.
- The Solana implementation is not deleted. It stays beside the EVM one.
