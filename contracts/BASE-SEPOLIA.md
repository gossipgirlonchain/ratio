# Doppler prediction market on Base Sepolia — verified addresses

**Verified live on-chain 2026-09-06** by direct RPC against `https://sepolia.base.org`.
Not taken from docs; the docs do not mention any of this.

## Addresses

| Contract | Address | Verified state |
|---|---|---|
| `PredictionMigrator` | `0x91aad599EfD70E633d091FC060cc6f9D3e5298BE` | 4,329 bytes; Airlock module state **4 = LiquidityMigrator** |
| `NoSellDopplerHook` | `0x21588C923de63914cbc624002417c2AA64a15bFe` | 1,082 bytes; `isDopplerHookEnabled` = **3** (ON_INITIALIZATION \| ON_SWAP) |
| `MockPredictionOracle` | `0xaE92178EE4eDEa87273dbDe36dA015039115d46a` | 443 bytes; `isFinalized()` = false, `owner()` = deployer |
| `Airlock` | `0x3411306Ce66c9469BFF1535BA955503c4Bde1C6e` | existing protocol |
| `DopplerHookInitializer` | `0xAA096F558f3d4c9226De77E7Cc05f18E180B2544` | module state **3 = PoolInitializer** |

Deployed 2026-02-18 by `0x97a90100d77D05E309cdeB7e2AaF91F0EF8CA5ac`, block `0x2413fba`,
chain id `0x14a34` (84532). All three deploy receipts `status: 0x1`.

## How to re-verify

```bash
RPC=https://sepolia.base.org
AIRLOCK=0x3411306Ce66c9469BFF1535BA955503c4Bde1C6e
INIT=0xAA096F558f3d4c9226De77E7Cc05f18E180B2544

# 4 = LiquidityMigrator
cast call $AIRLOCK "getModuleState(address)(uint8)" \
  0x91aad599EfD70E633d091FC060cc6f9D3e5298BE --rpc-url $RPC

# 3 = ON_INITIALIZATION_FLAG | ON_SWAP_FLAG
cast call $INIT "isDopplerHookEnabled(address)(uint256)" \
  0x21588C923de63914cbc624002417c2AA64a15bFe --rpc-url $RPC
```

## Provenance, and what it means for us

These are **not on `main`**. They come from PR
[#481 "prediction markets"](https://github.com/whetstoneresearch/doppler/pull/481),
branch `pred-markets`, plus one extra commit `41605c4e "Deploy prediction market to
Base Sep"` that lives only on the `pr-481` branch. The PR is **open**, opened
2026-02-06, last touched 2026-03-01, still awaiting review.

`pred-markets` is **309 commits behind `main`** and 6 ahead. The deployed
`DopplerHookInitializer` and `Airlock` are the current protocol addresses from
`deployments.config.toml`, so the prediction modules were deployed against live
protocol rather than a private fork — the whitelist calls succeeded, which means
the Airlock owner ran them.

**We are its first integration.** The deployment had never processed a
transaction — zero `EntryRegistered`, `EntryMigrated` and `Claimed` events from
deployment in February to the moment we arrived.

## The first real ratio market — 2026-09-07, block 46488077

Full lifecycle broadcast, 13 transactions, all `status 0x1`, 8,063,615 gas total.

| Contract | Address |
|---|---|
| `RatioOracleFactory` | `0xCFeBFF30bf95E9bD5EEBBA7cD6c78c5764d090Dd` |
| market oracle | `0x834cdD5461F9E00dcc841840f7710C4827D2e4d7` |
| side A token | `0x45B86F46c59675648B87E42779DDC4f2387Da8be` |
| side B token | `0x9CFa0D8F56F18C65185111c8277faa3235659693` |

| Step | Tx |
|---|---|
| deploy `RatioOracleFactory` | `0xf6b350622426c30c2ace2b1b722e35c2daa61e1f66397bc119b3af071e092977` |
| `createOracle` | `0xff625a229d896d5114022cd7163f0b139b5ffa308f740723b478e8f23f0bb64d` |
| `airlock.create` side A | `0xb95d5e7f3177b992d659f2bb0d13fff96dc61d4b75e0ba47136faa5085b9a135` |
| `airlock.create` side B | `0x005412bf31c43137f5b8e78c00ebb5c7b3b928149822af9b33d9cc8ba2db54b0` |
| `setEntryTokens` | `0x46460199585b271095611916f5a1d40eac81ba15efcb8622384f9d311dab7774` |
| bet on side B | `0xb766cc3f17a1bc6e90a6f8bc6ea8bdd53197b2274ce0c1ff17bf0257d211befd` |
| bet on side A | `0x86abdb342aa098017056e2b8023b0ad5b97a0268871cd114fea86e3a08cbd962` |
| `declareWinner(side B)` | `0x82b3f56cd64d4d154cd988316c778dfe4630d07c8a984355dfa8f3ee94dee076` |
| `airlock.migrate` side A | `0x76ba9cc622060496c2ba47d41798f37c9fce8f4b7766e0c7dc44f52f4ffb4a07` |
| `airlock.migrate` side B | `0x16416811e171c58e4843536ec42f2303efab63bf5e248fc81ee624768ddab8b6` |
| `claim` | `0x4431d69d64551210c1c2d0a61ba496a9e735251ea57f2dacf1498bf9e8c41060` |

Explorer: `https://sepolia.basescan.org/tx/<hash>`

Oracle state, read back from chain afterwards: `isFinalized true`, `winnerSide 1`,
`winningToken 0x9CFa0D8F…`, and `getWinner()` returning the same pair the migrator
consumed.

Pot 399999999999998 wei; `previewClaim` 399999999999955 wei; the claim paid exactly
that. Reproduce with `script/LifecycleBaseSepolia.s.sol`.

Only Base Sepolia. There is no `DeployPredictionMarket` script for any other chain,
and `PredictionMigrator` appears nowhere in `Deployments.json` on `main`.

## No SDK, indexer, or API support

Confirmed zero hits for `PredictionMigrator` / `IPredictionOracle` /
`NoSellDopplerHook` in `doppler-sdk`, `doppler-indexer` and `doppler-api`, and zero
mentions of prediction markets anywhere in the published docs (checked against
`docs.doppler.lol/llms-full.txt`, the complete docs corpus).

So we call these contracts directly with viem. There is no builder, no helper, and
no indexer schema to inherit — which is also precisely why the subgraph is ours to
build.
