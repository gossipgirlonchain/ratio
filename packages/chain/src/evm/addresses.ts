/**
 * Base Sepolia addresses. Every one verified live on chain, and every one
 * exercised by a real transaction — see contracts/BASE-SEPOLIA.md for hashes.
 *
 * Not read from Doppler's deployments.config.toml at runtime: the prediction
 * modules exist only on an unmerged branch of that file, so pinning them here
 * with provenance is more honest than pretending they are discoverable.
 */
import type { EvmAddresses } from "./index.js";

export const BASE_SEPOLIA_CHAIN_ID = 84532;

export const BASE_SEPOLIA: EvmAddresses = {
  // Doppler protocol, live on main
  airlock: "0x3411306Ce66c9469BFF1535BA955503c4Bde1C6e",
  hookInitializer: "0xAA096F558f3d4c9226De77E7Cc05f18E180B2544",
  governanceFactory: "0x7bD798fafC99A3b17E261F8308A8C11B56935ea1",
  poolManager: "0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408",

  // clone_derc20_v2_votes_factory. NOT token_factory_80: its token's burn() is
  // owner-gated, and Airlock hands ownership to the timelock before the
  // migrator tries to burn, so migrate() reverts. FEEDBACK.md section 2.
  tokenFactory: "0x16F5ACB64F4FA17296E942C51d3395aDC318f9e1",

  // Doppler prediction market — PR #481, deployed to Base Sepolia and
  // whitelisted, but absent from main, the docs, the SDK and the indexer.
  predictionMigrator: "0x91aad599EfD70E633d091FC060cc6f9D3e5298BE",
  noSellHook: "0x21588C923de63914cbc624002417c2AA64a15bFe",

  // Ours, deployed 2026-09-07. Its `agent` is the operator, so markets can
  // only be opened by us; reusable as long as the operator key is unchanged.
  ratioOracleFactory: "0xCFeBFF30bf95E9bD5EEBBA7cD6c78c5764d090Dd",

  // v4-core PoolSwapTest, deployed alongside. This is a v4 TEST router and it
  // is fine on testnet, but it is the one address here that should not survive
  // to mainnet — a production bet rail wants its own minimal router.
  swapRouter: "0xd2F10CE0F6EcacF0762e8E3f1E736C3C48747931",
};

/**
 * Default RPC. sepolia.base.org rejects the EIP-8130 `nonce_key` parameter that
 * foundry nightlies send ("not active before the Cobalt hard fork"), which cost
 * us an hour — viem does not send it, so this is fine here, and the fix for
 * foundry was pinning 1.5.1-stable rather than changing RPC.
 */
export const BASE_SEPOLIA_RPC = "https://sepolia.base.org";
