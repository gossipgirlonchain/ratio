/**
 * Devnet stand-in for Privy: real keypairs, funded from the operator, keyed
 * to the numeric X user id behind the same WalletProvider seam. R4 swaps in
 * PrivyWalletProvider with zero engine changes; the sponsored-gas shape is
 * identical (operator pays, user signs).
 */
import { getTransferSolInstruction } from "@solana-program/system";
import {
  generateKeyPairSigner,
  lamports,
  type TransactionSigner,
} from "@solana/kit";

import { sendInstructions, type Clients } from "@ratio/doppler/tx";

import type { Wallet, WalletProvider } from "./wallets.js";

export class LocalWalletProvider implements WalletProvider {
  private byXId = new Map<string, TransactionSigner>();
  private byAddress = new Map<string, TransactionSigner>();

  constructor(
    private readonly clients: Clients,
    private readonly operator: TransactionSigner,
    private readonly fundLamports: bigint = 100_000_000n, // 0.1 SOL
  ) {}

  async getWallet(xUserId: string): Promise<Wallet> {
    const existing = this.byXId.get(xUserId);
    if (existing) return { address: existing.address };

    const signer = await generateKeyPairSigner();
    await sendInstructions({
      clients: this.clients,
      payer: this.operator,
      label: `fund wallet for x:${xUserId}`,
      instructions: [
        getTransferSolInstruction({
          source: this.operator,
          destination: signer.address,
          amount: lamports(this.fundLamports),
        }),
      ],
    });
    this.byXId.set(xUserId, signer);
    this.byAddress.set(signer.address, signer);
    return { address: signer.address };
  }

  /** The chain adapter resolves bettor addresses back to signers here. */
  signerFor(address: string): TransactionSigner {
    const signer = this.byAddress.get(address);
    if (!signer) throw new Error(`no local signer for ${address}`);
    return signer;
  }
}
