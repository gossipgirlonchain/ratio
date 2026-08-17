/**
 * In-memory market store + the bot's post log. Dev-only persistence (a
 * Map on globalThis survives HMR); production swaps this for the real
 * store — same seam idea as the X provider.
 *
 * Eligibility (all four, spec-exact):
 *  1. the reply is the user's own (enforced by how the flow reaches here)
 *  2. parent tweet under 12h old
 *  3. at least one other person on the same parent
 *  4. no existing market on this PAIR
 */

import { FIGHT_WINDOW_MS, MARKET_DURATION_MS, SITE_URL } from "./config";
import { botMarketOpen } from "./copy";
import { Opponent, UserReply, XUser } from "./types";

export interface MarketSide {
  handle: string;
  avatarUrl: string;
  text: string;
  tweetId: string;
  /** like count at creation; live count derives from this (mock) */
  likesAtCreate: number;
}

export interface TeaserMarket {
  id: string;
  kind: "reply" | "quote";
  parentTweetId: string;
  parentAuthorHandle: string;
  /** the person who started it (side we attach the QT to) */
  challenger: MarketSide;
  /** the opponent they picked */
  mainchar: MarketSide;
  createdAtMs: number;
  settlesAtMs: number;
  /** what the bot posted, and where (display log for the teaser) */
  botPost: { text: string; repliedTo: "original tweet" | "the quote tweet" };
}

type Store = { markets: Map<string, TeaserMarket>; seq: number };
const g = globalThis as unknown as { __ratioTeaser?: Store };
const store: Store = (g.__ratioTeaser ??= { markets: new Map(), seq: 0 });

export const marketUrl = (id: string) => `${SITE_URL}/m/${id}`;

export const getMarket = (id: string) => store.markets.get(id) ?? null;

export const pairKey = (a: string, b: string) => [a, b].sort().join("|");

export const existingMarketForPair = (tweetA: string, tweetB: string) => {
  for (const m of store.markets.values())
    if (pairKey(m.challenger.tweetId, m.mainchar.tweetId) === pairKey(tweetA, tweetB))
      return m;
  return null;
};

export const marketsOnParent = (parentTweetId: string, challengerTweetId: string) => {
  const out: TeaserMarket[] = [];
  for (const m of store.markets.values())
    if (m.parentTweetId === parentTweetId && m.challenger.tweetId === challengerTweetId)
      out.push(m);
  return out;
};

export function createMarket(
  user: XUser,
  reply: UserReply,
  opponent: Opponent,
): { ok: true; market: TeaserMarket } | { ok: false; reason: string } {
  const age = Date.now() - reply.parent.createdAtMs;
  if (age > FIGHT_WINDOW_MS) return { ok: false, reason: "too old. tweets have to be under 12h" };
  const dupe = existingMarketForPair(reply.id, opponent.tweetId);
  if (dupe) return { ok: false, reason: "already a market on this one" };

  const id = `m${++store.seq}-${(Date.now() % 1e7).toString(36)}`;
  const market: TeaserMarket = {
    id,
    kind: reply.kind,
    parentTweetId: reply.parent.id,
    parentAuthorHandle: reply.parent.author.handle,
    challenger: {
      handle: user.handle,
      avatarUrl: user.avatarUrl,
      text: reply.text,
      tweetId: reply.id,
      likesAtCreate: 0,
    },
    mainchar: {
      handle: opponent.author.handle,
      avatarUrl: opponent.author.avatarUrl,
      text: opponent.text,
      tweetId: opponent.tweetId,
      likesAtCreate: opponent.likes,
    },
    createdAtMs: Date.now(),
    settlesAtMs: Date.now() + MARKET_DURATION_MS,
    botPost: {
      text: botMarketOpen(user.handle, opponent.author.handle, marketUrl(id)),
      // QT markets get the bot reply ON the quote tweet itself — a reply
      // under the original would never be seen by either fighter
      repliedTo: reply.kind === "quote" ? "the quote tweet" : "original tweet",
    },
  };
  store.markets.set(id, market);
  return { ok: true, market };
}

/** Mock live likes: deterministic growth since creation so the market
 * card visibly moves between refreshes. */
export function liveLikes(m: TeaserMarket): { challenger: number; mainchar: number } {
  const elapsedMin = (Date.now() - m.createdAtMs) / 60_000;
  const grow = (base: number, salt: number) =>
    Math.floor(base + elapsedMin * (2 + ((base + salt) % 7)));
  return {
    challenger: grow(m.challenger.likesAtCreate, 3),
    mainchar: grow(m.mainchar.likesAtCreate, 5),
  };
}
