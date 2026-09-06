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

**The deployment has never been used.** Zero `EntryRegistered`, zero
`EntryMigrated`, zero `Claimed` events from block `0x2413fba` to head. We would be
its first integration.

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
