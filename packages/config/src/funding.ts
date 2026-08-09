/**
 * Funding seam (UI spec §11). v1 is crypto-native: the wallet is visible
 * and fundable, not hidden plumbing — but the METHOD of funding sits behind
 * this interface because onramp availability shifts with regulation and we
 * will likely swap providers. The app enumerates methods and renders
 * whatever is available; supporting more than one at once is the point.
 *
 * Implementations, in priority order (§11, settled 2026-08-03):
 *  - direct_transfer: USDC straight into the embedded wallet — the PRIMARY
 *    path. Deposit address prominent, copyable, QR. Works everywhere,
 *    always, regardless of provider availability.
 *  - hosted_onramp: MoonPay or equivalent as a convenience alongside.
 *
 * THERE IS NO CONNECT-WALLET FLOW AND THERE NEVER WILL BE. Auth is X login
 * only; the Privy embedded wallet is the only wallet a user has. Do not
 * add Phantom, Solflare, Backpack, or WalletConnect. If a future task
 * appears to need it, STOP AND RAISE IT.
 *
 * Identity does not change with any of these: the embedded wallet is
 * auto-provisioned on first stake and accrues fees for people who have
 * never touched the product.
 */

export type FundingMethodKind = "direct_transfer" | "hosted_onramp";

export interface FundingSession {
  kind: FundingMethodKind;
  /** Hosted onramp: the provider URL to open. */
  url?: string;
  /** Direct transfer: the deposit address to show (copy + QR). */
  depositAddress?: string;
}

export interface FundingMethod {
  kind: FundingMethodKind;
  label: string;
  /** Regulation/region gates change under us — availability is a call, not a constant. */
  available(): Promise<boolean>;
  start(opts: { walletAddress: string }): Promise<FundingSession>;
}
