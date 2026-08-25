/**
 * Every user-facing string the bot posts. All templates take the handle or
 * market data as parameters; nothing here (or anywhere) hardcodes the handle.
 *
 * Cost policy (ported from cue-wire): exactly ONE linked post per market, the
 * creation card. Everything else stays link-free.
 */

const fmtUtc = (ms: number): string =>
  new Date(ms).toISOString().slice(0, 16).replace("T", " ");

export type RejectionReason =
  | "not_reply_or_quote"
  | "too_old"
  | "same_author"
  | "own_post"
  | "unreadable";

export const rejection = (reason: RejectionReason, botHandle: string): string => {
  switch (reason) {
    case "not_reply_or_quote":
      return `tag @${botHandle} on a reply or quote tweet. that tweet becomes side B, the tweet it answers is side A, most likes in 24h wins.`;
    case "too_old":
      return `too late. side B has to be under 12 hours old when you tag me.`;
    case "same_author":
      return `both sides are the same account. no self ratios.`;
    case "own_post":
      return `no markets on your own post. if a reply is coming for you, someone else has to call it.`;
    case "unreadable":
      return `i cannot read both tweets, so no market. both sides have to be public.`;
  }
};

/**
 * Duplicate pair = an interested user one step from a market they already
 * want. Convert, don't just reject: this reply carries the market link, a
 * deliberate exception to the one-linked-post-per-market cost policy
 * (a $0.20 post that lands on someone already reaching for the product).
 */
export const duplicatePointer = (): string =>
  `someone beat you to this one. the market is already live, bet on it here:`;

/** Relative durations for card copy: "3 days" / "24h" / "40m". */
export const humanDuration = (ms: number): string => {
  const h = Math.round(ms / 3_600_000);
  if (h >= 48) return `${Math.round(h / 24)} days`;
  if (h >= 1) return `${h}h`;
  return `${Math.max(1, Math.round(ms / 60_000))}m`;
};

/**
 * The market card (card spec, winny 2026-08-25): a QUOTE TWEET of one of
 * the two tweets, exactly four lines, the fourth being the market url
 * (appended by postQuote's link param). The quoted tweet needs no
 * description — it sits right above this copy. quotedHandle is always
 * the example handle on line 3, so a copy-paste reply is a valid bet on
 * the tweet the reader is looking at. "$X" is literal. Relative duration
 * only. No labels, no slogans, no predictions, lowercase throughout.
 */
export const marketCard = (opts: {
  quotedHandle: string;
  opponentHandle: string;
  closesInMs: number;
}): string =>
  `@${opts.quotedHandle} vs @${opts.opponentHandle}\n` +
  `likes only. closes in ${humanDuration(opts.closesInMs)}.\n` +
  `reply "$X @${opts.quotedHandle}" to bet.`;

export const betConfirm = (opts: {
  handle: string;
  amountUsd: number;
  backedHandle: string;
  sideAHandle: string;
  impliedAPct: number;
}): string =>
  `locked: @${opts.handle} put $${opts.amountUsd} on @${opts.backedHandle}. money says ${opts.impliedAPct}% @${opts.sideAHandle}.`;

export const recap = (opts: {
  winner: "a" | "b";
  likesA: number;
  likesB: number;
  moneyImpliedAPct: number;
  tie: boolean;
  sideAHandle: string;
  sideBHandle: string;
}): string => {
  const moneySawIt =
    (opts.winner === "a" && opts.moneyImpliedAPct >= 50) ||
    (opts.winner === "b" && opts.moneyImpliedAPct < 50);
  const verdict = opts.tie
    ? `dead heat ${opts.likesA}-${opts.likesB}. tie goes to the original, @${opts.sideAHandle} holds the line.`
    : opts.winner === "b"
      ? `ratio confirmed, @${opts.sideBHandle} takes it ${opts.likesB}-${opts.likesA}.`
      : `@${opts.sideAHandle} held the line ${opts.likesA}-${opts.likesB}.`;
  return `${verdict} money had @${opts.sideAHandle} at ${opts.moneyImpliedAPct}%: ${
    moneySawIt ? "the money saw it coming" : "the likes surprised the money"
  }. winners claim at ratio.wtf`;
};

/**
 * Forfeit recap: a side became unreadable (deleted, suspended, private,
 * blocked) and the market settles for the side that is still standing.
 * Observation wording — state what happened, never why. Nobody deletes
 * their way out of losing.
 */
export const forfeitRecap = (opts: {
  winnerHandle: string;
  loserHandle: string;
}): string =>
  `@${opts.loserHandle}'s side is no longer public. @${opts.winnerHandle} takes it by forfeit. winners claim at ratio.wtf`;

/**
 * Posted once when the hidden badge goes live. Guardrail: OBSERVATION, not
 * accusation — replies also vanish from threads through blocks and
 * deletions, so we state what we can see and let the audience draw the
 * conclusion. Never name the account that did the hiding.
 */
export const hiddenNotice = (): string =>
  `this reply is no longer showing in the thread. the market is still open.`;
