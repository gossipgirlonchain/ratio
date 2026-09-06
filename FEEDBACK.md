# Developer feedback — Uniswap v4 / Doppler

Written as we hit things, not reconstructed at the end. Ratio is a prediction
market built on Doppler (Uniswap v4 hooks) for both entry pricing and settlement.
We built the Solana version first, so most of this is the experience of moving a
working Doppler integration from Solana to EVM.

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

## 2. The prediction-market path is blocked on Base Sepolia by two module-wiring problems

Having found the deployment, we tried to use it. Both entries create fine and
then the lifecycle stops. Neither problem is in `PredictionMigrator` itself —
both are wiring — and between them they cost a day, which is why they are worth
writing down precisely.

We found these by forking Base Sepolia and running the real deployed bytecode.
Reproduction is `contracts/test/BaseSepoliaLifecycle.t.sol` in our repo.

### 2a. The deploy script points at a token factory that is not whitelisted

`script/DeployPredictionMarketBaseSepolia.s.sol` reads its token factory from
config as `clone_erc20_factory`:

```solidity
tokenFactory: config.get("clone_erc20_factory").toAddress(),
```

and validates it with `require(existing.tokenFactory.code.length > 0)`. That
check passes. But `Airlock.getModuleState(0xbf4Ca4D5...)` returns **0
(NotWhitelisted)**, so `airlock.create` reverts for anyone following the script's
own choice of modules.

The validation checks that the address has code, not that it is a usable module.
Asserting `getModuleState == ModuleState.TokenFactory` in `_validateExistingAddresses`
would have caught it at deploy time.

### 2b. `migrate()` reverts because the migrator cannot burn the unsold tokens

This is the more interesting one. With `token_factory_80` — which **is**
whitelisted — markets create successfully, entries register, the oracle
finalizes, and then `airlock.migrate(asset)` reverts with:

```
OwnableUnauthorizedAccount(0x91aad599EfD70E633d091FC060cc6f9D3e5298BE)
                            ^ PredictionMigrator
```

The trace shows why. `Airlock.migrate` does this, in this order:

```
Airlock::migrate(asset)
  ├─ asset::unlockPool()
  ├─ asset::transferOwnership(0x…dEaD)        <- ownership moves to the timelock
  ├─ initializer::exitLiquidity(asset)
  ├─ asset::transfer(migrator, 999999999999999999999980)
  └─ migrator::migrate(...)
       ├─ oracle::getWinner(oracle)            -> (tokenB, true)
       ├─ asset::balanceOf(migrator)
       ├─ asset::totalSupply()
       └─ asset::burn(999999999999999999999980)  <- REVERT, migrator is not owner
```

`PredictionMigrator.migrate` burns the unsold entry tokens to compute
`claimableSupply = totalSupply - unsold`. But Airlock has already transferred
token ownership to the timelock two calls earlier, and that token's `burn()` is
owner-gated. The migrator can never satisfy it.

The integration guide does warn that "if burn is unavailable/restricted,
`migrate` reverts" — but it is the interaction that bites: ownership is moved by
Airlock, mid-migration, before the migrator gets to run. No amount of care when
choosing a token factory helps if the factory's burn is owner-gated, because the
migrator is never the owner by the time it needs to be.

**Suggestions, cheapest first:**

1. State in the integration guide which deployed token factories are actually
   compatible, per chain. "Entry tokens must support `burn(uint256)`" is true but
   not actionable — a developer cannot tell from an address whether its burn is
   owner-gated.
2. Have `PredictionMigrator.initialize` reject a token whose burn it will not be
   able to call, so the failure lands at `create` time with a clear error rather
   than at `migrate`, after a market has taken real money.
3. Point the Base Sepolia deploy script at a compatible factory and assert module
   state during validation.

### What actually works

`clone_derc20_v2_votes_factory` (`0x16F5ACB64F4FA17296E942C51d3395aDC318f9e1`) is
whitelisted, and its `CloneDERC20VotesV2.burn` is open:

```solidity
function burn(uint256 amount) external { _burn(msg.sender, amount); }
```

It takes a different `tokenFactoryData` shape — `(string, string, uint256,
VestingSchedule[], address[], uint256[], uint256[], string)` rather than the two
plain uints — which is not documented anywhere we could find, and which we
recovered from `legacy/src/tokens/CloneDERC20VotesV2Factory.sol`.

With that factory the full lifecycle completes: create both entries, bet on both
sides, finalize, migrate both, claim pro rata. `previewClaim` matched the actual
payout to the wei.

We could not have routed around this by deploying our own token factory: the
Airlock owner is `AirlockMultisigTestnet` and both `setModuleState` and
`addSigner` are `onlySigner`. An integrator who hits 2b and has no compatible
whitelisted factory is simply stuck until someone at Whetstone acts.

## 3. The pool fee is dynamic regardless of what you pass

`InitData.fee` is not the pool's fee. The initializer creates the pool with
`LPFeeLibrary.DYNAMIC_FEE_FLAG` (`0x800000`) whatever you pass, so a `PoolKey`
reconstructed with the fee you supplied will not find the pool — `extsload`
returns an uninitialized slot and swaps revert somewhere unhelpful.

We only worked this out by reading `modifyLiquidity` arguments out of a call
trace. Either document that the fee is always dynamic, or ignore the field and
remove it from `InitData`.

## 4. `allowSell: true` is accepted config that the hook silently overrides

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

On EVM the equivalent is `NoSellDopplerHook`, which is at least named for what it
does — a developer reading the deploy script knows immediately that sells are off,
where on Solana the same behaviour is an undocumented override of config that
claims the opposite. That naming is the right pattern; the Solana side should
borrow it.

## 5. Beneficiary limits are documented per chain, but only for one chain

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

## 6. Small things

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
