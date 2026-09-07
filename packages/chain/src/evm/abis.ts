/**
 * Minimal ABIs for the deployed Doppler contracts and our own oracle.
 *
 * Hand-written rather than generated: we need six functions across four
 * contracts, and vendoring the pred-markets branch (309 commits behind main)
 * into the TypeScript build to generate them would be a far bigger dependency
 * than this file.
 *
 * Every signature here was exercised by a real transaction on Base Sepolia —
 * see contracts/BASE-SEPOLIA.md for the hashes.
 */

export const airlockAbi = [
  {
    type: "function",
    name: "create",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "createData",
        type: "tuple",
        components: [
          { name: "initialSupply", type: "uint256" },
          { name: "numTokensToSell", type: "uint256" },
          { name: "numeraire", type: "address" },
          { name: "tokenFactory", type: "address" },
          { name: "tokenFactoryData", type: "bytes" },
          { name: "governanceFactory", type: "address" },
          { name: "governanceFactoryData", type: "bytes" },
          { name: "poolInitializer", type: "address" },
          { name: "poolInitializerData", type: "bytes" },
          { name: "liquidityMigrator", type: "address" },
          { name: "liquidityMigratorData", type: "bytes" },
          { name: "integrator", type: "address" },
          { name: "salt", type: "bytes32" },
        ],
      },
    ],
    outputs: [
      { name: "asset", type: "address" },
      { name: "pool", type: "address" },
      { name: "governance", type: "address" },
      { name: "timelock", type: "address" },
      { name: "migrationPool", type: "address" },
    ],
  },
  {
    type: "function",
    name: "migrate",
    stateMutability: "nonpayable",
    inputs: [{ name: "asset", type: "address" }],
    outputs: [],
  },
  {
    type: "function",
    name: "owner",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
] as const;

export const predictionMigratorAbi = [
  {
    type: "function",
    name: "previewClaim",
    stateMutability: "view",
    inputs: [
      { name: "oracle", type: "address" },
      { name: "tokenAmount", type: "uint256" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "claim",
    stateMutability: "nonpayable",
    inputs: [
      { name: "oracle", type: "address" },
      { name: "tokenAmount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "event",
    name: "EntryMigrated",
    inputs: [
      { name: "oracle", type: "address", indexed: true },
      { name: "entryId", type: "bytes32", indexed: true },
      { name: "token", type: "address", indexed: false },
      { name: "contribution", type: "uint256", indexed: false },
      { name: "claimableSupply", type: "uint256", indexed: false },
    ],
  },
] as const;

export const ratioOracleFactoryAbi = [
  {
    type: "function",
    name: "createOracle",
    stateMutability: "nonpayable",
    inputs: [
      { name: "marketId", type: "uint256" },
      { name: "settlesAt", type: "uint64" },
    ],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "predictOracle",
    stateMutability: "view",
    inputs: [{ name: "marketId", type: "uint256" }],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "oracleOf",
    stateMutability: "view",
    inputs: [{ name: "marketId", type: "uint256" }],
    outputs: [{ type: "address" }],
  },
] as const;

export const ratioOracleAbi = [
  {
    type: "function",
    name: "setEntryTokens",
    stateMutability: "nonpayable",
    inputs: [
      { name: "tokenA", type: "address" },
      { name: "tokenB", type: "address" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "declareWinner",
    stateMutability: "nonpayable",
    inputs: [
      { name: "side", type: "uint8" },
      { name: "likesA", type: "uint256" },
      { name: "likesB", type: "uint256" },
      { name: "forfeit", type: "bool" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "entryTokens",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "tokensSet",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "isFinalized",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "bool" }],
  },
] as const;

export const erc20Abi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "totalSupply",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { type: "address" },
      { type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
] as const;

/** v4-core's PoolSwapTest, which we deploy once and reuse as the bet rail. */
export const poolSwapAbi = [
  {
    type: "function",
    name: "swap",
    stateMutability: "payable",
    inputs: [
      {
        name: "key",
        type: "tuple",
        components: [
          { name: "currency0", type: "address" },
          { name: "currency1", type: "address" },
          { name: "fee", type: "uint24" },
          { name: "tickSpacing", type: "int24" },
          { name: "hooks", type: "address" },
        ],
      },
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "zeroForOne", type: "bool" },
          { name: "amountSpecified", type: "int256" },
          { name: "sqrtPriceLimitX96", type: "uint160" },
        ],
      },
      {
        name: "testSettings",
        type: "tuple",
        components: [
          { name: "takeClaims", type: "bool" },
          { name: "settleUsingBurn", type: "bool" },
        ],
      },
      { name: "hookData", type: "bytes" },
    ],
    outputs: [{ name: "delta", type: "int256" }],
  },
] as const;
