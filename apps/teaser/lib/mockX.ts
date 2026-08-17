/**
 * Deterministic mock X. Same fixture philosophy as apps/web/lib/fixtures:
 * pages are queries against a fake world, and swapping in a real provider
 * later is a data-source change, not a redesign. Everything derives from a
 * string hash, so a handle always gets the same personality — but tweet
 * ages are offsets from "now", so countdowns tick for real.
 *
 * Test handles: "lurker" (zero replies), "ghost" (not found), "locked"
 * (private). Everything else resolves.
 */

import {
  Lookup,
  Opponent,
  ParentTweet,
  UserReply,
  XProvider,
  XUser,
} from "./types";
import { SCORE_WINDOW_MS } from "./config";

const H = 3_600_000;
const av = (h: string) => `https://i.pravatar.cc/120?u=${h}`;

// mulberry32 over a string hash: cheap, stable, good enough for fixtures
const hash = (s: string): number => {
  let h = 1779033703 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
};
const rng = (seed: string) => {
  let a = hash(seed);
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
const pick = <T,>(r: () => number, xs: T[]): T => xs[Math.floor(r() * xs.length)]!;

// --- the rooms: accounts people reply to -----------------------------------
// Follower counts span the range so the ROOMS score input has texture.
const ROOMS: XUser[] = [
  { handle: "bigaccount", name: "big account", avatarUrl: av("bigaccount"), followers: 812_000 },
  { handle: "ceoposter", name: "ceo poster", avatarUrl: av("ceoposter"), followers: 2_400_000 },
  { handle: "chartbrother", name: "chart brother", avatarUrl: av("chartbrother"), followers: 640_000 },
  { handle: "opinionhaver", name: "opinion haver", avatarUrl: av("opinionhaver"), followers: 96_000 },
  { handle: "thinskinned", name: "founder mode", avatarUrl: av("thinskinned"), followers: 187_000 },
  { handle: "mainchar", name: "main character", avatarUrl: av("mainchar"), followers: 54_000 },
  { handle: "protocolguy", name: "protocol guy", avatarUrl: av("protocolguy"), followers: 310_000 },
  { handle: "vibetrader", name: "vibe trader", avatarUrl: av("vibetrader"), followers: 22_000 },
  { handle: "quotedigest", name: "quote digest", avatarUrl: av("quotedigest"), followers: 1_100_000 },
  { handle: "microcapmax", name: "microcap max", avatarUrl: av("microcapmax"), followers: 8_400 },
];

const PARENT_TEXTS = [
  "the bottom is in. you can screenshot this",
  "unpopular opinion but remote work made everyone worse at their jobs",
  "we are so back",
  "raising a small fund. dm if serious",
  "criticism of my product is just engagement farming at this point",
  "nobody is talking about what happens when the unlock hits",
  "just deleted my whole draft folder. felt nothing",
  "cereal is a soup",
  "if you can't explain your token in one sentence you don't have a token",
  "the real alpha is going to bed early",
  "every cycle the same people learn the same lesson at the same price",
  "shipped. that's the tweet",
];

const REPLY_TEXTS = [
  "brave of you to post this with the chart upside down",
  "this is exactly the kind of take that sounds smart until you spend five minutes with the numbers",
  "screenshotting this before it disappears, which it will",
  "aged like milk and it has only been six hours",
  "no.",
  "saying this with a locked account is crazy",
  "the sequel to this tweet is going to be incredible",
  "not you giving financial advice from a default avatar",
  "least wrong take on my timeline today, somehow",
  "watch me say it anyway",
  "this is why nobody invites you to the group chats",
  "delete this before someone with a bloomberg terminal sees it",
];

const OPPONENT_POOL = [
  "replyguy", "quietkid", "hiddenreply", "witness", "scout", "carol",
  "dave", "erin", "fred", "gina", "gary", "deleter",
];

// --- parent tweets ---------------------------------------------------------
/** Parent identity must be stable across lookup() and opponents(): id
 * encodes room + slot, and everything else re-derives from the id. */
const parentFor = (roomIdx: number, slot: number, now: number): ParentTweet => {
  const author = ROOMS[roomIdx % ROOMS.length]!;
  const r = rng(`parent:${author.handle}:${slot}`);
  // Slot 0-2 land inside 12h (fights exist), the rest spread over 7 days.
  const ageMs =
    slot < 3
      ? (0.4 + r() * 10.5) * H * (slot + 1) * 0.33
      : 12 * H + r() * (SCORE_WINDOW_MS - 12 * H);
  return {
    id: `t-${roomIdx}-${slot}`,
    author,
    text: pick(r, PARENT_TEXTS),
    createdAtMs: now - ageMs,
    replyCount: Math.floor(3 + r() * 40),
  };
};

const parentById = (id: string, now: number): ParentTweet | null => {
  const m = /^t-(\d+)-(\d+)$/.exec(id);
  return m ? parentFor(Number(m[1]), Number(m[2]), now) : null;
};

// --- provider --------------------------------------------------------------
export const mockX: XProvider = {
  async lookup(handle: string): Promise<Lookup> {
    if (handle === "ghost") return { ok: false, reason: "not_found" };
    if (handle === "locked") return { ok: false, reason: "private" };

    const user: XUser = {
      handle,
      name: handle,
      avatarUrl: av(handle),
      followers: Math.floor(rng(`f:${handle}`)() * 40_000) + 200,
    };
    if (handle === "lurker") return { ok: true, user, replies: [] };

    const r = rng(`replies:${handle}`);
    const now = Date.now();
    // volume personality: 5..170 replies in the window
    const n = Math.floor(5 + r() ** 1.6 * 165);
    // speed personality: median-ish seconds to reply, 20s..30min
    const baseSpeed = 20 + r() ** 2 * 1780;
    const replies: UserReply[] = [];
    for (let i = 0; i < n; i++) {
      const roomIdx = Math.floor(r() * ROOMS.length);
      const slot = i < 6 ? i % 4 : 3 + Math.floor(r() * 9);
      const parent = parentFor(roomIdx, slot, now);
      const delayS = baseSpeed * (0.3 + r() * 1.7);
      replies.push({
        id: `r-${handle}-${i}`,
        kind: r() < 0.25 ? "quote" : "reply",
        text: pick(r, REPLY_TEXTS),
        createdAtMs: parent.createdAtMs + delayS * 1000,
        parent,
      });
    }
    // one reply per parent (a market is a pair; dupes would collide),
    // newest first
    const seen = new Set<string>();
    const deduped = replies.filter((x) =>
      seen.has(x.parent.id) ? false : (seen.add(x.parent.id), true),
    );
    deduped.sort((a, b) => b.createdAtMs - a.createdAtMs);
    return { ok: true, user, replies: deduped };
  },

  async opponents(parentTweetId: string, excludeHandle: string): Promise<Opponent[]> {
    const now = Date.now();
    const parent = parentById(parentTweetId, now);
    if (!parent) return [];
    const r = rng(`opp:${parentTweetId}`);
    const count = Math.min(parent.replyCount, 3 + Math.floor(r() * 9));
    const out: Opponent[] = [];
    const used = new Set<string>([excludeHandle, parent.author.handle]);
    for (let i = 0; i < count; i++) {
      const handle = pick(r, OPPONENT_POOL);
      if (used.has(handle)) continue;
      used.add(handle);
      out.push({
        tweetId: `o-${parentTweetId}-${handle}`,
        kind: r() < 0.25 ? "quote" : "reply",
        author: {
          handle,
          name: handle,
          avatarUrl: av(handle),
          followers: Math.floor(rng(`f:${handle}`)() * 40_000) + 200,
        },
        text: pick(r, REPLY_TEXTS),
        likes: Math.floor(r() ** 2 * 4000),
      });
    }
    return out.sort((a, b) => b.likes - a.likes);
  },
};
