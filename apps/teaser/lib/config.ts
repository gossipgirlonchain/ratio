/**
 * Every tunable in the teaser lives here. The spec's weights are a starting
 * point, not law — retune freely, but keep the invariants in comments.
 */

export const SITE_NAME = "ratio";
/** Absolute base for share links + card unfurls. Override in prod. */
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3010";

// --- windows ---------------------------------------------------------------
/** Score looks back 7 days: stable, snapshot-like. */
export const SCORE_WINDOW_MS = 7 * 24 * 3_600_000;
/** A fight's PARENT tweet must be under 12h old (the market needs 24h of
 * live like movement to settle on — a dead thread can't referee). */
export const FIGHT_WINDOW_MS = 12 * 3_600_000;
/** Market clock. */
export const MARKET_DURATION_MS = 24 * 3_600_000;

// --- score -----------------------------------------------------------------
export const SCORE_MAX = 5000;

/** Weights sum to 1. None of the inputs need like counts. */
export const W_VOLUME = 0.4; // how much they post
export const W_SPEED = 0.25; // how fast they pounce
export const W_ROOMS = 0.35; // how big the rooms they walk into are

/** Volume: log-scaled, saturates around this many replies in 7d. */
export const VOLUME_SATURATION = 200;
/** Speed: median seconds to reply; at or under this = full marks. */
export const SPEED_SATURATION_S = 60;
/** Rooms: log-scaled median follower count of accounts replied to;
 * saturates here (walking into bigger rooms stops paying). */
export const ROOMS_SATURATION_FOLLOWERS = 2_000_000;

export const TIERS: { min: number; badge: string }[] = [
  { min: 4500, badge: "MENACE" },
  { min: 3500, badge: "CERTIFIED REPLY GUY" },
  { min: 2250, badge: "REPLY GUY" },
  { min: 1000, badge: "CASUAL" },
  { min: 0, badge: "LURKER" },
];

export const tierFor = (score: number): string =>
  TIERS.find((t) => score >= t.min)!.badge;

/** Percentile seed distribution size (mock stands in for the precomputed
 * crypto-Twitter seed list — open question 4 decides who's really in it). */
export const SEED_DISTRIBUTION_N = 3000;
/** Below the top-50% cut the card shows a band, not a rank, so it stays
 * postable. Ordered by percentile-from-top. */
export const PERCENTILE_BANDS: { maxTopPct: number; label: string }[] = [
  { maxTopPct: 75, label: "middle of the pack" },
  { maxTopPct: 100, label: "mostly watching" },
];
