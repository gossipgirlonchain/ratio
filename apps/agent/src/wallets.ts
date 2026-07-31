/**
 * X user id -> wallet. Production = Privy server wallets keyed to the NUMERIC
 * X user id (never the handle — handles get changed, sold, and squatted;
 * handles are display cache only). First touch auto-provisions, whether or
 * not the person has ever used the product: side A and side B authors get
 * wallets at market creation so fees can accrue before they ever log in.
 *
 * R4 wires PrivyWalletProvider + ATA creation folded into the same
 * sponsored-gas path. The engine only ever sees this interface.
 */

export interface Wallet {
  address: string;
}

export interface WalletProvider {
  /** Wallet for an X user, auto-provisioned on first touch. */
  getWallet(xUserId: string): Promise<Wallet>;
}

/** Sim/dev provider: deterministic fake addresses, tracks provisioning order. */
export class MockWalletProvider implements WalletProvider {
  provisioned: string[] = [];
  private wallets = new Map<string, Wallet>();

  async getWallet(xUserId: string): Promise<Wallet> {
    const existing = this.wallets.get(xUserId);
    if (existing) return existing;
    const wallet = { address: `wallet:${xUserId}` };
    this.wallets.set(xUserId, wallet);
    this.provisioned.push(xUserId);
    return wallet;
  }
}
