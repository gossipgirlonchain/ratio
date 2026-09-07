/**
 * Local EVM wallets for the Base Sepolia sim: real keypairs, funded from the
 * operator, behind the same WalletProvider seam Privy fills in production.
 *
 * The EVM counterpart of walletsDevnet.ts. Privy is a network round trip per
 * signature and needs Supabase rows; for a sim that just wants two bettors who
 * can sign, generated keys are the same shape with none of the setup.
 */
import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  parseEther,
  toHex,
  type Account,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

import { SerialQueue } from "@ratio/chain/evm";

import type { Wallet, WalletProvider } from "./wallets.js";

export class LocalEvmWalletProvider implements WalletProvider {
  private byXId = new Map<string, Account>();
  /** The engine provisions three wallets in one Promise.all; three concurrent
   * sends from the operator would collide on nonce. */
  private readonly queue = new SerialQueue();
  private readonly inflight = new Map<string, Promise<Wallet>>();
  private byAddress = new Map<string, Account>();
  private readonly pub;
  private readonly operatorWallet;

  constructor(
    private readonly rpcUrl: string,
    private readonly operator: Account,
    /** Seed for deriving sim wallets. See `derive`. */
    private readonly seed: Hex,
    /** A stake is ~0.0004 ETH and Base Sepolia gas is 0.006 gwei, so this is
     * already generous. It was 0.004, which stranded 0.02 ETH per run. */
    private readonly fundEth = "0.0015",
  ) {
    this.pub = createPublicClient({ chain: baseSepolia, transport: http(rpcUrl) });
    this.operatorWallet = createWalletClient({
      account: operator,
      chain: baseSepolia,
      transport: http(rpcUrl),
    });
  }

  async getWallet(xUserId: string): Promise<Wallet> {
    const existing = this.byXId.get(xUserId);
    if (existing) return { address: existing.address };
    // Same id asked for twice concurrently must fund once, not twice.
    const pending = this.inflight.get(xUserId);
    if (pending) return pending;
    const p = this.provision(xUserId).finally(() => this.inflight.delete(xUserId));
    this.inflight.set(xUserId, p);
    return p;
  }

  private async provision(xUserId: string): Promise<Wallet> {

    // The treasury is the operator itself: it seeds both sides at creation and
    // funding a separate wallet to do that would just move the money twice.
    if (xUserId === "ratio:treasury") {
      this.byXId.set(xUserId, this.operator);
      this.byAddress.set(this.operator.address.toLowerCase(), this.operator);
      return { address: this.operator.address };
    }

    /**
     * DERIVED, not random. Fresh keys each run meant every run stranded its
     * funding in wallets nobody could ever reach again — five wallets a run,
     * and the operator was empty after four. Deriving from the operator key
     * means a re-run reuses the same wallets and their leftover balance.
     */
    const account = this.derive(xUserId);
    const already = await this.pub.getBalance({ address: account.address });
    const target = parseEther(this.fundEth);
    if (already >= target) {
      console.log(`    reusing ${xUserId} -> ${account.address} (${Number(already) / 1e18} ETH)`);
      this.byXId.set(xUserId, account);
      this.byAddress.set(account.address.toLowerCase(), account);
      return { address: account.address };
    }

    // Send AND confirm inside the queue. Releasing after the send is not
    // enough: the next transaction then asks the node for a nonce while the
    // previous one is still in the mempool, and Base Sepolia hands back the
    // same one — "replacement transaction underpriced".
    await this.queue.run(this.operator.address, async () => {
      const hash = await this.operatorWallet.sendTransaction({
        to: account.address,
        value: target - already,
        chain: baseSepolia,
        account: this.operator,
      });
      await this.pub.waitForTransactionReceipt({ hash });
    });

    // A confirmed transfer is not immediately visible to every read replica
    // behind a public RPC. The engine checks the bettor's balance before it
    // will place a bet, so returning while that still reads zero makes the
    // bot tell a funded person they are broke. Wait until it is visible.
    for (let i = 0; i < 20; i++) {
      if ((await this.pub.getBalance({ address: account.address })) > 0n) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    console.log(`    funded ${xUserId} -> ${account.address} (${this.fundEth} ETH)`);

    this.byXId.set(xUserId, account);
    this.byAddress.set(account.address.toLowerCase(), account);
    return { address: account.address };
  }

  /** Deterministic per (seed, x id): same person, same wallet, every run. */
  private derive(xUserId: string): Account {
    return privateKeyToAccount(keccak256(toHex(`${this.seed}:${xUserId}`)));
  }

  accountFor(address: string): Account {
    const a = this.byAddress.get(address.toLowerCase());
    if (!a) throw new Error(`no local evm signer for ${address}`);
    return a;
  }

  async balance(address: Address): Promise<bigint> {
    return this.pub.getBalance({ address });
  }
}
