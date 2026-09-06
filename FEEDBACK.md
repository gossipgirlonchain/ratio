# Developer feedback — Uniswap v4 / Doppler

Written as we hit things, not reconstructed at the end. Ratio is a prediction
market whose entry pricing is Doppler (Uniswap v4 hooks) and whose settlement we
had to write ourselves. We built the Solana version first, so most of this is the
experience of moving a working Doppler integration from Solana to EVM.

Context: ETHOnline 2026, one week, porting `github.com/gossipgirlonchain/ratio`.

---

## 1. The prediction lifecycle is Solana-only, and nothing says so

**This was the single biggest finding of the port and it changed the shape of the
week.**

On Solana, Doppler gives you a complete prediction-market lifecycle: a trusted
oracle, per-outcome XYK curves, `finalize(winner)` gating migration, migration
into a single pot, and a pro-rata `claim`. We built ratio on exactly that. The
assumption going into the EVM port — reasonable, because Doppler is EVM-native
and the Solana build was the port — was that the same lifecycle would be there,
probably nicer.

It is not there. EVM ships Airlock, the initializer families (Standard,
Scheduled, Decay, Rehype, multicurve), the migrators (V2, V3, V4, Split, NoOp)
and `dopplerLaunchHookV1`. There is no oracle-resolved migrator and no prediction
module. The only prediction-market example in the SDK repo is
`examples/solana-prediction-market.ts`.

**What made this expensive:** nothing in the docs states the asymmetry. The
capability matrix is implicit — you infer it by noticing which examples exist and
which contracts appear in the deployments table. We found it by cross-referencing
the contract-addresses page against the SDK's example directory, which is not a
thing a developer should have to do to answer "can I build this here".

**And the asymmetry is narrower than it first looks, which makes the silence
worse rather than better.** The EVM side has clearly been prepared for this use
case. `test/integration/ImmediateMigration.t.sol` in the contracts repo says, in
its own words:

> This is a key requirement for prediction markets where migration should be
> gated by oracle, not by tick.

It proves that setting `farTick == startTick` lets migration happen immediately
with zero proceeds, i.e. that the tick gate can be taken out of the way so
something else can do the gating. That constraint was removed deliberately, for
prediction markets, and the test stands as evidence of intent.

**And the module that fills the hole exists, is deployed, and is undiscoverable.**
`PredictionMigrator`, `NoSellDopplerHook` and `MockPredictionOracle` are live on
Base Sepolia and wired into the real Airlock — the migrator is whitelisted as a
`LiquidityMigrator` and the hook is enabled on the `DopplerHookInitializer`. They
ship with an integration guide, a versioned spec, unit and integration tests, and
four invariant suites.

None of it is on `main`. It lives on PR #481, open since February. The Base
Sepolia deploy commit is not even on the PR branch — it is on a separate `pr-481`
branch. The addresses are in `deployments.config.toml` and nowhere else:
`Deployments.json`, `Deployments.md`, the docs, the SDK, the indexer and the API
all have zero mentions.

So the feedback is not "EVM cannot do prediction markets", and it is not "the
module was never written". It is: **the module is written, deployed, whitelisted
on a public testnet, and there is no path by which a developer reading the docs
could ever find it.** We only found it by enumerating branches and pull requests
on the contracts repo after three separate documentation searches said the
capability did not exist.

That is the expensive part. A working, deployed feature that the documentation
actively implies is absent costs more than a missing feature, because a team will
confidently build the thing you already built. We were one decision away from
spending two days writing our own settlement contract.

**What would have saved us most of a day:** a per-feature support matrix with
Solana and EVM as columns. Even a one-line note on the prediction-market example
saying "Solana only; on EVM the tick gate can be disabled but no oracle-resolved
migrator ships" would have been enough.

**What we did:** wrote the missing piece as an `ILiquidityMigrator`, so it
registers as an Airlock module rather than sitting beside the protocol as a
private escrow. Doppler prices entry through the curves; our migrator holds the
oracle gate, the pot, and the pro-rata claim. We are writing it as something we
would be happy to hand over, because on this reading it is a module-shaped gap in
your own architecture rather than an application-level workaround.

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
