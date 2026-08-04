/**
 * Indicative parimutuel payout quote (UI spec §7).
 *
 *   payout = stake × (potA + potB + stake) ÷ (yourSide + stake) × (1 − fee)
 *
 * Your own stake joins the pot AND dilutes your side, so the multiplier is a
 * function of stake size — that dilution is the brigading defence (§8) and
 * we surface it rather than hide it.
 *
 * Two honesty notes, encoded here so they are not lost:
 *  - The quote is INDICATIVE. The pot moves between quote and landing, and
 *    again before settlement. Say once in the flow, not per interaction.
 *  - On-chain claims weight by TOKEN COUNT, and the XYK curve prices large
 *    stakes progressively worse than this linear formula (a $500 stake on a
 *    thin side really lands nearer the spec's 2.26x than this formula's
 *    2.69x). v2: quote from the chain's preview-swap instruction instead.
 */

export const TOTAL_FEE_RATE = 0.0125; // = SWAP_FEE_BPS in @ratio/config

export interface PayoutQuote {
  payoutUsd: number;
  multiple: number;
}

export function quotePayout(opts: {
  stakeUsd: number;
  potAUsd: number;
  potBUsd: number;
  /** Pot already on the side being backed. */
  yourSideUsd: number;
  feeRate?: number;
}): PayoutQuote {
  const fee = opts.feeRate ?? TOTAL_FEE_RATE;
  const { stakeUsd } = opts;
  if (stakeUsd <= 0) return { payoutUsd: 0, multiple: 0 };
  const payoutUsd =
    ((stakeUsd * (opts.potAUsd + opts.potBUsd + stakeUsd)) /
      (opts.yourSideUsd + stakeUsd)) *
    (1 - fee);
  return { payoutUsd, multiple: payoutUsd / stakeUsd };
}

/** `$97.45 if they win · 3.90x` — the inline quote line (§7). */
export function formatQuote(q: PayoutQuote): string {
  return `$${q.payoutUsd.toFixed(2)} if they win · ${q.multiple.toFixed(2)}x`;
}
