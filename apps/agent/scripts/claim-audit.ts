/**
 * Why a claim reverts.
 *
 * The claim is two transactions — approve the migrator for the winning
 * tokens, then claim — and a TRANSFER_FROM_FAILED tells you the second one
 * could not pull them, without saying whether the allowance, the balance or
 * the token itself is the reason. This reads all three and then simulates the
 * claim as the holder, which is the only way to see the revert the holder
 * would actually get.
 *
 *   npx tsx apps/agent/scripts/claim-audit.ts <oracle> <token> <holder>
 */
import { createPublicClient, erc20Abi, http } from "viem";
import { baseSepolia } from "viem/chains";

import { BASE_SEPOLIA, BASE_SEPOLIA_RPC } from "@ratio/chain/evm";

const [oracle, token, holder] = process.argv.slice(2) as [`0x${string}`, `0x${string}`, `0x${string}`];
if (!holder) throw new Error("usage: claim-audit <oracle> <token> <holder>");

const pub = createPublicClient({
  chain: baseSepolia,
  transport: http(process.env.BASE_SEPOLIA_RPC_URL ?? BASE_SEPOLIA_RPC),
});

const migratorAbi = [
  { type: "function", name: "claim", stateMutability: "nonpayable", inputs: [{ name: "oracle", type: "address" }, { name: "amount", type: "uint256" }], outputs: [] },
  { type: "function", name: "previewClaim", stateMutability: "view", inputs: [{ name: "oracle", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "uint256" }] },
] as const;

async function main() {
  const [balance, allowance] = await Promise.all([
    pub.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [holder] }),
    pub.readContract({
      address: token,
      abi: erc20Abi,
      functionName: "allowance",
      args: [holder, BASE_SEPOLIA.predictionMigrator],
    }),
  ]);
  console.log(`holder   ${holder}`);
  console.log(`balance  ${balance}`);
  console.log(`allowed  ${allowance} (to the migrator)`);

  try {
    const preview = await pub.readContract({
      address: BASE_SEPOLIA.predictionMigrator,
      abi: migratorAbi,
      functionName: "previewClaim",
      args: [oracle, balance],
    });
    console.log(`preview  ${preview} wei out`);
  } catch (err) {
    console.log(`preview  reverted: ${(err as Error).message.split("\n")[0]}`);
  }

  try {
    await pub.simulateContract({
      address: BASE_SEPOLIA.predictionMigrator,
      abi: migratorAbi,
      functionName: "claim",
      args: [oracle, balance],
      account: holder,
    });
    console.log("claim    would succeed");
  } catch (err) {
    const m = (err as Error).message;
    console.log(`claim    reverts: ${m.split("\n").slice(0, 4).join(" / ")}`);
  }
}

main();
