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
export const BOT_HANDLE = process.env.RATIO_BOT_HANDLE ?? "ratio";

/** Side B must be under 12h old at mention time (PLAN: dominant pricing input). */
export const FRESHNESS_WINDOW_MS = 12 * 60 * 60 * 1000;

/** Every market runs created_at + 24h, settled on absolute like counts. */
export const MARKET_DURATION_MS = 24 * 60 * 60 * 1000;

/** Mid-window tweet health check runs once past this fraction of the window. */
export const HEALTH_CHECK_AT_FRACTION = 0.5;

/** Stake caps ported from cue-wire launch sizing ($5 keeps confirms margin-positive). */
export const MIN_STAKE_USD = 5;
export const MAX_STAKE_USD = 250;

// ---------------------------------------------------------------------------
// Fees — confirmed 2026-07-31. Five beneficiaries, weights immutable once the
// market's curves launch.
// ---------------------------------------------------------------------------

/** TODO(fees): swap fee itself still undecided; 200 = cue-wire precedent. */
export const SWAP_FEE_BPS = 200;

/**
 * Share of the swap fee per party, in bps of the fee (sums to 10_000).
 * Forfeit rule (R2): side A's share redistributes evenly across tagger,
 * side B, and protocol; Doppler's cut is untouched. Because on-chain weights
 * are IMMUTABLE after creation, forfeit redistribution is enforced at the
 * claim layer (side A's accrued share swept on forfeit), never as a
 * re-weight. Irreversible once flagged.
 */
export const FEE_SHARE_BPS = {
  doppler: 750, // 7.5%
  protocol: 4_500, // 45% — ratio treasury
  sideA: 1_800, // 18%
  sideB: 1_800, // 18%
  tagger: 1_150, // 11.5%
} as const;

/** Market page URL for the one linked post per market. */
export const marketUrl = (marketId: string): string =>
  `https://ratio.wtf/m/${marketId}`;
