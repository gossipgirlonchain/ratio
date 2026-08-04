/**
 * Funding seam (UI spec §11). v1 is crypto-native: the wallet is visible
 * and fundable, not hidden plumbing — but the METHOD of funding sits behind
 * this interface because onramp availability shifts with regulation and we
 * will likely swap providers. The app enumerates methods and renders
 * whatever is available; supporting more than one at once is the point.
 *
 * Candidate implementations, in spec order:
 *  - hosted_onramp: MoonPay or equivalent, card -> wallet
 *  - direct_transfer: USDC straight to the ratio wallet (surface the
 *    deposit address with copy affordance + QR)
 *  - external_wallet: Phantom etc. connecting directly
 *
 * Identity does not change with any of these: the Privy embedded wallet is
 * still auto-provisioned on first stake and still accrues fees for people
 * who have never touched the product.
 */

export type FundingMethodKind =
  | "hosted_onramp"
  | "direct_transfer"
  | "external_wallet";

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
