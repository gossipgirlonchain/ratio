/**
 * Did the money actually move?
 *
 * A market can be resolved on our oracle and still have nothing to claim:
 * resolution is our contract, migration is Doppler's, and only migration moves
 * the pools' proceeds into the pot. The subgraph reports both, but when the
 * two disagree the question is always "is the index wrong, or did the chain
 * never do it" — so this asks the chain directly, and then simulates the
 * migration that is missing to get the revert reason out of it.
 *
 *   npx tsx apps/agent/scripts/migration-audit.ts
 */
import { createPublicClient, http, parseAbiItem } from "viem";
import { baseSepolia } from "viem/chains";

import { BASE_SEPOLIA, BASE_SEPOLIA_RPC } from "@ratio/chain/evm";

/** Just the one function. Migration is permissionless once its conditions
 * hold, so this simulates from no particular caller. */
const airlockAbi = [
  {
    type: "function",
    name: "migrate",
    stateMutability: "nonpayable",
    inputs: [{ name: "asset", type: "address" }],
    outputs: [],
  },
] as const;

const pub = createPublicClient({
  chain: baseSepolia,
  transport: http(process.env.BASE_SEPOLIA_RPC_URL ?? BASE_SEPOLIA_RPC),
});

const MIGRATOR = BASE_SEPOLIA.predictionMigrator;
const START = 46_488_000n;

const registered = parseAbiItem(
  "event EntryRegistered(address indexed oracle, bytes32 indexed entryId, address token, address numeraire)",
);
const migrated = parseAbiItem(
  "event EntryMigrated(address indexed oracle, bytes32 indexed entryId, address token, uint256 contribution, uint256 claimableSupply)",
);

/** Base Sepolia's public RPC caps eth_getLogs at 10k blocks, so walk it. */
async function logsOf(event: typeof registered | typeof migrated, head: bigint) {
  const out = [];
  for (let from = START; from <= head; from += 9_999n) {
    const to = from + 9_998n > head ? head : from + 9_998n;
    out.push(...(await pub.getLogs({ address: MIGRATOR, event, fromBlock: from, toBlock: to })));
  }
  return out;
}

async function main() {
  const head = await pub.getBlockNumber();
  const reg = await logsOf(registered, head);
  const mig = await logsOf(migrated, head);

  if (process.env.ORACLE) {
    const want = process.env.ORACLE.toLowerCase();
    for (const l of reg) {
      if ((l.args.oracle as string).toLowerCase() !== want) continue;
      console.log(`registered entryId=${l.args.entryId} token=${l.args.token} block=${l.blockNumber} tx=${l.transactionHash}`);
    }
    for (const l of mig) {
      if ((l.args.oracle as string).toLowerCase() !== want) continue;
      console.log(`migrated   entryId=${l.args.entryId} block=${l.blockNumber}`);
    }
    return;
  }

  const tokens = new Map<string, `0x${string}`[]>();
  for (const l of reg) {
    const o = (l.args.oracle as string).toLowerCase();
    tokens.set(o, [...(tokens.get(o) ?? []), l.args.token as `0x${string}`]);
  }
  const done = new Set(mig.map((l) => (l.args.oracle as string).toLowerCase()));

  console.log(`${reg.length} entries registered across ${tokens.size} markets`);
  console.log(`${mig.length} entries migrated across ${done.size} markets\n`);

  for (const [oracle, toks] of tokens) {
    if (done.has(oracle)) {
      console.log(`${oracle}  migrated`);
      continue;
    }
    // Both sides: the loser's entry migrates too, and a revert on either one
    // aborts the whole settlement.
    const reasons: string[] = [];
    for (const t of toks) {
      try {
        await pub.simulateContract({
          address: BASE_SEPOLIA.airlock,
          abi: airlockAbi,
          functionName: "migrate",
          args: [t],
        });
        reasons.push(`${t.slice(0, 10)} ok`);
      } catch (err) {
        const msg = (err as Error).message;
        const sig = /0x[0-9a-f]{8}/i.exec(msg.split("Details")[0] ?? "")?.[0];
        const named = /reverted with the following reason:\s*\n(.+)/.exec(msg)?.[1];
        const custom = /Error:\s*(\w+\(\))/.exec(msg)?.[1];
        reasons.push(`${t.slice(0, 10)} ${named ?? custom ?? sig ?? msg.slice(0, 60)}`);
      }
    }
    console.log(`${oracle}  NOT migrated: ${reasons.join(" | ")}`);
  }
}

main();
