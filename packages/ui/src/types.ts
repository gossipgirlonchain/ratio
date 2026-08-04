/**
 * One strip, one market — always (UI spec §2). No aggregate state exists
 * anywhere: no per-post counts inside a container, no combined pots, no
 * "the OP is winning". A post with six markets renders six strips.
 */

export type StripStatus = "open" | "settled" | "voided";

export interface StripSide {
  handle: string; // shown on the button — users see people, not letters
  likes: number;
  potUsd: number;
}

export interface MarketStripData {
  marketId: string;
  /** The original post's author. */
  a: StripSide;
  /** The reply/QT author (their text renders in the strip, clamped). */
  b: StripSide;
  replyText: string;
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
