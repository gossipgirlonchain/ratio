/**
 * The X data seam. Everything the site needs from X fits in XProvider —
 * score inputs deliberately avoid like counts, so a cheap/scraped source
 * works. Open question 1 (X API vs scraping provider) is answered by
 * swapping the implementation behind this interface, nothing else moves.
 */

export interface XUser {
  handle: string; // lowercase, no @
  name: string;
  avatarUrl: string;
  followers: number;
}

export interface ParentTweet {
  id: string;
  author: XUser;
  text: string;
  createdAtMs: number;
  /** How many OTHER people replied to / quoted it (opponent pool size). */
  replyCount: number;
}

export interface UserReply {
  id: string;
  kind: "reply" | "quote";
  text: string;
  createdAtMs: number;
  parent: ParentTweet;
}

/** Someone else who replied to / quoted the same parent: an opponent. */
export interface Opponent {
  tweetId: string;
  kind: "reply" | "quote";
  author: XUser;
  text: string;
  likes: number;
}

export type Lookup =
  | { ok: true; user: XUser; replies: UserReply[] }
  | { ok: false; reason: "not_found" | "private" };

export interface XProvider {
  /** User + their replies/QTs in the score window, newest first. */
  lookup(handle: string): Promise<Lookup>;
  /** Everyone else on the same parent tweet. */
  opponents(parentTweetId: string, excludeHandle: string): Promise<Opponent[]>;
}

export const normalizeHandle = (raw: string): string =>
  raw.trim().replace(/^@+/, "").toLowerCase();
