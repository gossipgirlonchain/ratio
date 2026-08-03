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

export const marketCard = (opts: {
  settlesAtMs: number;
  sideAHandle: string;
  sideBHandle: string;
}): string =>
  `market open: @${opts.sideBHandle} vs @${opts.sideAHandle}. most likes when the clock runs out wins, the likes are the referee. ` +
  `stake with a reply: "$25 A" or "$10 B". settles ${fmtUtc(opts.settlesAtMs)} UTC. live odds:`;

export const betConfirm = (opts: {
  handle: string;
  amountUsd: number;
  side: 0 | 1;
  impliedAPct: number;
}): string =>
  `locked: @${opts.handle} put $${opts.amountUsd} on ${opts.side === 0 ? "A" : "B"}. money says ${opts.impliedAPct}% A.`;

export const recap = (opts: {
  winner: "a" | "b";
  likesA: number;
  likesB: number;
  moneyImpliedAPct: number;
  tie: boolean;
}): string => {
  const moneySawIt =
    (opts.winner === "a" && opts.moneyImpliedAPct >= 50) ||
    (opts.winner === "b" && opts.moneyImpliedAPct < 50);
  const verdict = opts.tie
    ? `dead heat ${opts.likesA}-${opts.likesB}. tie goes to the original, side A holds the line.`
    : opts.winner === "b"
      ? `ratio confirmed, side B takes it ${opts.likesB}-${opts.likesA}.`
      : `side A held the line ${opts.likesA}-${opts.likesB}.`;
  return `${verdict} money had A at ${opts.moneyImpliedAPct}%: ${
    moneySawIt ? "the money saw it coming" : "the likes surprised the money"
  }. winners claim at ratio.wtf`;
};

export const voidNotice = (reason: string): string =>
  `market voided: ${reason}. everyone exits at the curve, sell your tokens back to get out.`;

/**
 * Posted once when the hidden badge goes live. Guardrail: OBSERVATION, not
 * accusation — replies also vanish from threads through blocks and
 * deletions, so we state what we can see and let the audience draw the
 * conclusion. Never name the account that did the hiding.
 */
export const hiddenNotice = (): string =>
  `this reply is no longer showing in the thread. the market is still open.`;
