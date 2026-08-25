/**
 * One strip, one market — always (UI spec §2). No aggregate state exists
 * anywhere: no per-post counts inside a container, no combined pots, no
 * "the OP is winning". A post with six markets renders six strips.
 */

/** No voids exist: unreadable sides forfeit, seeding kills zero-winner. */
export type StripStatus = "open" | "settled" | "forfeited";

export interface StripSide {
  handle: string;
  /** Profile picture; absent renders an initial. The row reads like a tweet. */
  avatarUrl?: string;
  /** The tweet's text. Both sides carry it: the OP is a competitor row,
   * not context — the matchup must be legible in one glance. */
  text: string;
  likes: number;
  potUsd: number;
  /** Link to the actual post on X; renders a small outbound arrow. */
  tweetUrl?: string;
}

export interface MarketStripData {
  marketId: string;
  /** The original post: row one. */
  a: StripSide;
  /** The reply/QT: row two. */
  b: StripSide;
  settlesAtMs: number;
  status: StripStatus;
  winner?: "a" | "b";
  voidReason?: string;
  /**
   * Extension-corroborated display flag ONLY — never touches settlement.
   * Worded as observation, surfaced as a story beat, not an error.
   */
  hiddenFromThread?: boolean;
}
