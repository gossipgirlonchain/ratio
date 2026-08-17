/**
 * Every outward-facing line, verbatim from the spec. All lowercase, all
 * from the bot except the user QT. Do not rewrite casually — the user QT
 * copy in particular is reasoned: likes settle the market, so it talks to
 * the READER (who decides), never at the opponent (the bot already tagged
 * them under the original). It is not a callout.
 */

export const botMarketOpen = (challenger: string, mainchar: string, link: string) =>
  `market open. @${challenger} vs @${mainchar}\nmost likes in 24h wins\n${link}`;

export const botSettled = (winner: string, winLikes: number, loseLikes: number, link: string) =>
  `@${winner} wins. ${winLikes.toLocaleString("en-US")} to ${loseLikes.toLocaleString("en-US")}\n${link}`;

export const botRejectedTooOld = () => `too old. tweets have to be under 12h`;

export const botRejectedDuplicate = (link: string) => `already a market on this one\n${link}`;

export const userQuoteTweet = (link: string) =>
  `market open. most likes in 24h wins. you decide.\n${link}`;
