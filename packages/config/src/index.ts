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
 * SELLS: OFF. Devnet-proven 2026-08-11 (e2e-hook-gating.ts): the
 * prediction hook rejects sells in EVERY state — unresolved AND
 * finalized — and rejects buys once finalized. Trading is buy-only
 * until resolution, then halts. Positions are locked from purchase to
 * claim. Flip this only if Doppler changes the hook.
 */
export const SELLS_ENABLED = false;

/**
 * SHELVED, NOT DELETED (winny 2026-08-11): with sells impossible there is
 * no exit rush and this ramp has no job. The curve, config, and
 * instrumentation stay so it can come straight back if Doppler opens
 * sells up.
 *
 * Exit fee (§7b, shape decided 2026-08-03): TIME-BASED ONLY — never the
 * like gap, or closing the gap becomes the cheap-exit strategy, which is
 * the brigading attack wearing a new hat.
 *
 * The on-chain 1.25% swap fee is the FLOOR (locked at launch, charged in
 * both directions). Total exit fee sits at the floor for the first
 * RAMP_START hours (early exits are price discovery, and the pot has time
 * to refill), then rises SMOOTHLY to EXIT_FEE_MAX_BPS *total* (inclusive
 * of the floor) at the close — a late exit walks the prize out with
 * nothing to replace it. Smoothstep, not a step: its slope is zero at the
 * start point, so there is no hour-12 cliff to pile out in front of
 * (track sells around the start point anyway — Store.sellsNearRampStart).
 *
 * Everything above the floor is charged at the app layer (custody makes
 * it enforceable; no connect-wallet means custody covers everyone) and is
 * split the SAME FIVE WAYS, transfers composed into the atomic sell tx.
 * INVARIANTS: zero above-floor fee on voided markets (refunds are not
 * exits); the sell quote discloses rate AND dollars before commitment.
 *
 * Start, end, and ceiling are guesses — tune from real markets.
 */
export const EXIT_FEE_RAMP_START_MS = 12 * 60 * 60 * 1000;
export const EXIT_FEE_RAMP_END_MS = MARKET_DURATION_MS;
export const EXIT_FEE_MAX_BPS = 7_500; // 75% TOTAL at close, floor included

/** Total exit fee in bps at a given market age. Floor = SWAP_FEE_BPS. */
export function exitFeeBps(elapsedMs: number): number {
  const t = Math.min(
    1,
    Math.max(0, (elapsedMs - EXIT_FEE_RAMP_START_MS) / (EXIT_FEE_RAMP_END_MS - EXIT_FEE_RAMP_START_MS)),
  );
  const eased = t * t * (3 - 2 * t); // smoothstep: zero slope at both ends
  return Math.round(SWAP_FEE_BPS + (EXIT_FEE_MAX_BPS - SWAP_FEE_BPS) * eased);
}

/** The slice our app collects on a sell: total minus the on-chain floor. */
export function exitFeeSurchargeBps(elapsedMs: number): number {
  return exitFeeBps(elapsedMs) - SWAP_FEE_BPS;
}

/** Market page URL for the one linked post per market. */
export const marketUrl = (marketId: string): string =>
  `https://ratio.wtf/m/${marketId}`;
