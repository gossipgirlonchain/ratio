/**
 * All product knobs live here. Nothing outside this package hardcodes the
 * handle, windows, caps, or fee numbers.
 *
 * Fee mechanism (confirmed 2026-07-31): the prediction migrator path, exactly
 * as proven in cue-wire's devnet e2e. Fees are skimmed at swap time on each
 * outcome curve via `feeBeneficiaries[{wallet, shareBps}]`; settlement is
 * finalize(winner) -> migrate both entries -> pot -> claim. No CPMM branch.
 *
 * Five fee parties on every market:
 *   Doppler protocol / ratio treasury / tagger / side A author / side B author
 *
 * Doppler eng confirmed (2026-07-31): max FIVE beneficiaries per curve (hard
 * Solana tx-size limit), custom weights, set once at creation and immutable
 * after. All five slots are used. R3 is unblocked.
 */

/** X handle for the bot. NOT registered yet; override via env when it is. */
export const BOT_HANDLE = process.env.RATIO_BOT_HANDLE ?? "ratiowtf";

/** Side B must be under 12h old at mention time (PLAN: dominant pricing input). */
export const FRESHNESS_WINDOW_MS = 12 * 60 * 60 * 1000;

/** Every market runs created_at + 24h, settled on absolute like counts. */
export const MARKET_DURATION_MS = 24 * 60 * 60 * 1000;

/**
 * Treasury seed: SETTLEMENT INSURANCE, NOT LIQUIDITY (corrected
 * 2026-08-15). Doppler is a liquidity bootstrapping protocol: it blocks
 * external LPs entirely and the curve prices from VIRTUAL reserves —
 * (curveVirtualQuote + quoteVault) / (curveVirtualBase − sold) — so a
 * market with zero real money is fully tradable and correctly priced.
 * The seed exists for exactly one reason: at least one real holder on
 * each side, so settlement can never hit ZeroClaimableSupply (sells are
 * impossible, so that state would be unrefundable).
 *
 * At creation, BEFORE the bot posts the card,
 * the treasury buys this much on EACH side. With sells impossible, a
 * winning side with no money hits ZeroClaimableSupply and nothing can
 * refund — seeding makes that state unreachable. Treasury keeps seed winnings,
 * eats seed losses; ~break-even at scale, worst case ~= this per market.
 * Seed positions are plumbing: excluded from who's-in and positions.
 */
export const SEED_PER_SIDE_USD = 1;

/**
 * Likes sampling cadence for open markets. This replaced the mid-window
 * void health check (voids are deleted; unreadable sides settle as
 * forfeits at settlement time): same periodic tweet fetch, but now the
 * like counts are RECORDED — they are the chart's likes series, which
 * exists nowhere else.
 */
export const LIKES_SAMPLE_INTERVAL_MS = 60 * 60 * 1000;

/** Stake caps ported from cue-wire launch sizing ($5 keeps confirms margin-positive). */
export const MIN_STAKE_USD = 1; // matches the preset ladder — the buttons are the spec
export const MAX_STAKE_USD = 500;

/**
 * Hidden-reply badge (decided 2026-07-31): the browser extension reports a
 * reply missing from its thread. DISPLAY FLAG ONLY — never an input to
 * settlement, no forfeit, no redistribution. One report is one browser,
 * possibly lying or glitching; the flag goes live only after this many
 * INDEPENDENT reporters corroborate. Tunable.
 */
export const HIDDEN_REPORT_THRESHOLD = 3;

// ---------------------------------------------------------------------------
// Fees — confirmed 2026-07-31. Five beneficiaries, weights immutable once the
// market's curves launch.
// ---------------------------------------------------------------------------

/** Total swap fee — locked 2026-07-31. */
export const SWAP_FEE_BPS = 125; // 1.25%

/**
 * Devnet WSOL sim rate: $1 = 0.01 SOL prices SOL at $100 (spot,
 * 2026-08-26) so rent, fees, and balances read like mainnet will.
 * USDC production replaces this with 1_000_000n at 1e6/$.
 * NOTE: the @nathan_liow/@solana test market was priced at the original
 * 500_000n rate; its chain-read numbers skew until it settles. Accepted.
 */
export const LAMPORTS_PER_USD = 10_000_000n;

/**
 * Share of the swap fee per party, in bps of the fee (sums to 10_000).
 * Effective rates on volume: doppler 0.094%, treasury 0.52%, sides 0.21%
 * each, tagger 0.13%. Doppler hard-limits beneficiaries to FIVE per curve
 * (Solana tx size) and weights are IMMUTABLE once the market's curves
 * launch — no redistribution of any kind is possible after creation.
 * Parimutuel = no LPs, so there is no LP slice and the split stays at five.
 */
export const FEE_SHARE_BPS = {
  doppler: 750, // 7.5%
  protocol: 4_500, // 45% — ratio treasury
  sideA: 1_800, // 18%
  sideB: 1_800, // 18%
  tagger: 1_150, // 11.5%
} as const;

/**
 * SELLS: PERMANENTLY OFF — a PROTOCOL CONSTRAINT, not a product choice.
 * Do not flip this. Devnet-proven 2026-08-11 (e2e-hook-gating.ts) and
 * confirmed by the Doppler team 2026-08-12: the prediction hook rejects
 * sells in EVERY oracle state and this is not changing; `allowSell:
 * true` is dead config beneath it. The only lifecycle is buy while
 * unresolved → finalize → migrate → claim. Positions are locked from
 * purchase to settlement, and fees accrue on ENTRY only.
 */
export const SELLS_ENABLED = false;

/**
 * SHELVED AND DORMANT: sells are permanently off (see SELLS_ENABLED), so
 * this ramp is wired to NOTHING. The curve, these constants, and
 * Store.sellsNearRampStart stay only as a record of the decided shape.
 * The app-layer surcharge design that once accompanied it (atomic
 * split-at-source sell tx, beneficiary-wallet reads at build time,
 * surcharge fee events) is DELETED, not shelved — it only existed to
 * enforce a fee above the on-chain 1.25%, and there is no sell to
 * charge it on.
 *
 * Shape, for the record (decided 2026-08-03): TIME-BASED ONLY — never
 * the like gap, or closing the gap becomes the cheap-exit strategy,
 * which is the brigading attack wearing a new hat. Floor = the on-chain
 * 1.25%; flat through RAMP_START, then smoothstep (zero slope at the
 * start, no cliff to front-run) to EXIT_FEE_MAX_BPS total at close.
 */
export const EXIT_FEE_RAMP_START_MS = 12 * 60 * 60 * 1000;
export const EXIT_FEE_RAMP_END_MS = MARKET_DURATION_MS;
export const EXIT_FEE_MAX_BPS = 7_500; // 75% TOTAL at close, floor included

/** Total exit fee in bps at a given market age. Floor = SWAP_FEE_BPS.
 * Dormant: nothing calls this in the product (sells are off for good). */
export function exitFeeBps(elapsedMs: number): number {
  const t = Math.min(
    1,
    Math.max(0, (elapsedMs - EXIT_FEE_RAMP_START_MS) / (EXIT_FEE_RAMP_END_MS - EXIT_FEE_RAMP_START_MS)),
  );
  const eased = t * t * (3 - 2 * t); // smoothstep: zero slope at both ends
  return Math.round(SWAP_FEE_BPS + (EXIT_FEE_MAX_BPS - SWAP_FEE_BPS) * eased);
}

/** Market page URL for the one linked post per market. */
export const marketUrl = (marketId: string): string =>
  `https://ratio.wtf/m/${marketId}`;
