# Developer feedback — Uniswap v4 / Doppler

Written as we hit things, not reconstructed at the end. Ratio is a prediction
market whose entry pricing is Doppler (Uniswap v4 hooks) and whose settlement we
had to write ourselves. We built the Solana version first, so most of this is the
experience of moving a working Doppler integration from Solana to EVM.

Context: ETHOnline 2026, one week, porting `github.com/gossipgirlonchain/ratio`.

---

## 1. EVM prediction markets are built, deployed, and undiscoverable

**This was the single biggest finding of the port, it changed the shape of our
week twice, and it is the piece of feedback we would most want acted on.**

On Solana, Doppler gives you a complete prediction-market lifecycle: a trusted
oracle, per-outcome curves, `finalize(winner)` gating migration, migration into a
single pot, and a pro-rata claim. We built ratio on exactly that. Coming to EVM —
where Doppler is native, and where the Solana build was the port rather than the
original — we expected to find the same lifecycle.

Three separate documentation passes told us it did not exist:

- `docs.doppler.lol` has zero mentions of prediction markets, oracles, or
  resolution. We checked `llms-full.txt`, the complete docs corpus.
- The contract-addresses page lists no oracle or prediction module on any chain.
- The SDK's only prediction example is `examples/solana-prediction-market.ts`, and
  every `predictionMigrator` path in the SDK sits under `src/solana/`.

All of that is accurate, and all of it is misleading, because **the EVM
implementation exists and is already deployed to a public testnet**. On Base
Sepolia, right now:

| Contract | Address | State |
|---|---|---|
| `PredictionMigrator` | `0x91aad599EfD70E633d091FC060cc6f9D3e5298BE` | Airlock module state 4 = `LiquidityMigrator` |
| `NoSellDopplerHook` | `0x21588C923de63914cbc624002417c2AA64a15bFe` | `isDopplerHookEnabled` = 3 |
| `MockPredictionOracle` | `0xaE92178EE4eDEa87273dbDe36dA015039115d46a` | live |

Whitelisted against the real Airlock, hook enabled on the real
`DopplerHookInitializer`. It ships with an integration guide, a versioned spec, an
`IPredictionOracle` interface, unit and integration tests, and four invariant
suites. It is good work.

It is on PR #481, open since 2026-02-06 and last touched 2026-03-01. The Base
Sepolia deploy commit is not even on the PR branch — it is on a separate `pr-481`
branch. The addresses appear in `deployments.config.toml` and nowhere else:
`Deployments.json`, `Deployments.md`, the docs, the SDK, the indexer and the API
have zero mentions between them.

We found it only by enumerating every branch and pull request on the contracts
repo, after the documentation had told us three times that the capability was
absent. Then we verified it by RPC, because at that point we no longer trusted any
written source.

**Why this is more expensive than a missing feature.** A missing feature costs a
team a decision. A feature that exists, works, and is documented as absent costs
them the build. We had a plan, a frozen event schema, and two days of contract
work scheduled to write something you had already written, tested and deployed. A
less stubborn team ships the duplicate and never finds out.

**What would fix it, cheaply, in rough order of value:**

1. One line in the docs: "Prediction markets: Solana (mainnet, devnet) and Base
   Sepolia (preview, PR #481)." Even flagged as unreleased, that is enough.
2. A per-feature support matrix with Solana and EVM as columns. The asymmetries
   between the two are currently something you infer from which examples exist.
3. Get the deployed addresses into `Deployments.json` alongside everything else,
   or mark them explicitly as preview. `deployments.config.toml` is not where a
   developer looks.

**What we did:** integrated against the deployed `PredictionMigrator` rather than
writing our own, once we found it. Our contribution is the `IPredictionOracle`
implementation on top — and, as far as the chain can tell, the first real use of
these contracts: there were zero `EntryRegistered`, `EntryMigrated` and `Claimed`
events on that migrator before we arrived.

## 2. `allowSell: true` is accepted config that the hook silently overrides

On Solana, the launch is configured with `allowSell: true` and it looks like a
working feature. It is not: the prediction hook rejects sells in **every** oracle
state — unresolved, finalized, pre-migration, post-migration. We only established
this by writing a dedicated devnet probe (`e2e-hook-gating.ts`) that attempted a
sell in each state and read the error codes, and then confirming with the team.

Config that is accepted, stored, and then ignored by the hook beneath it is worse
than config that is rejected. A validation error at launch time — or documenting
that the prediction hook ignores `allowSell` — would have prevented us designing
an entire exit-fee ramp around a sell path that cannot exist. That design is
still sitting in our config as a shelved constant with a comment explaining why
it is wired to nothing.

This one has a genuine EVM upside worth stating: because we now own the
settlement contract on EVM, sells become possible again if we want them. We are
not building it this week, but the EVM path unlocks something the Solana path
structurally could not.

## 3. Beneficiary limits are documented per chain, but only for one chain

Solana's five-beneficiary cap is clearly documented as a transaction-size limit,
which is exactly the kind of constraint-with-a-reason that is useful — we designed
our fee split around it and it held.

The EVM side we could not answer from the docs. We found that beneficiaries are
set at creation and immutable, that shares are WAD-denominated, that the array
must be sorted ascending by address, and that the airlock owner must receive at
least 5% of streamed fees. We could not find a documented maximum count. For a
team deciding how many parties can share a fee — which is a product decision, not
an implementation detail — that number needs to be on the page next to the
Solana one.

The airlock-owner 5% floor in particular is a real design constraint that we only
found in passing. It belongs somewhere more prominent than it is: it changes how
you allocate a fee split, and a team that discovers it late has to redo their
economics.

## 4. Small things

- The SDK renamed `cpmmHookProgram` to `dopplerLaunchHookV1Program` around 1.0.30.
  Our integration carries a comment explaining that prediction launches must
  override it with `PREDICTION_HOOK_PROGRAM_ID`, because the default is wrong for
  this use and the failure is not obvious.
- `previewSwapExactIn` is the right primitive and we want it — a curve-priced
  entry means a linear pot-share quote overstates large stakes, and we have been
  shipping the linear approximation with a comment apologising for it. More
  prominent guidance that quotes must come from the preview instruction, rather
  than being derived from pool totals, would help anyone building on curve entry.

---

*Updated as the week goes. Sections are appended, not rewritten.*
