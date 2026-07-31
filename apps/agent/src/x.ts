/**
 * X (Twitter) layer. `XClient` is the only surface the engine sees; production
 * swaps MockXClient for a real X API v2 implementation with zero engine
 * changes. Ported from cue-wire with the poll surface deleted (no postPoll)
 * and tweet metadata the ratio mechanic needs added: created_at, like_count,
 * and the referenced-tweet edge (reply parent / quoted tweet).
 *
 * Cost policy baked into the interface (ported): postReply is link-free
 * ($0.015) unless `link` is set — the one $0.20 creation card per market.
 */

export type RefType = "quoted" | "replied_to";

export interface XTweet {
  tweetId: string;
  authorId: string;
  authorHandle: string;
  text: string;
  createdAtMs: number;
  likeCount: number;
  /** Reply parent or quoted tweet. Absent = standalone. */
  referencedTweet?: { type: RefType; tweetId: string };
}

export interface XMention {
  mentionTweetId: string;
  authorId: string;
  authorHandle: string;
  text: string;
  /** The tweet this mention replies to / quotes (pair resolution input). */
  target?: { tweetId: string; type: RefType };
}

export interface XClient {
  /** Poll own mentions since a cursor (pay-per-use read). */
  fetchMentions(sinceId?: string): Promise<XMention[]>;
  /**
   * Tweet lookup with public_metrics. Returns undefined ONLY when the tweet
   * is definitively unreadable: deleted, author suspended/deactivated/
   * private, or blocked out of view — the engine voids on that. Transient
   * failures (rate limit, 5xx, network) must THROW instead; the engine
   * retries those on the next cron tick and never voids on them.
   */
  getTweet(tweetId: string): Promise<XTweet | undefined>;
  /** Reply in-thread. `link` = the one $0.20 market card per market. */
  postReply(opts: {
    inReplyTo: string;
    text: string;
    link?: string;
  }): Promise<{ tweetId: string }>;
}

// ---------------------------------------------------------------------------
// Mock — scripted world for the sim and tests
// ---------------------------------------------------------------------------

let mockId = 1_000;
const nextId = () => String(++mockId);

export class MockXClient implements XClient {
  tweets = new Map<string, XTweet>();
  posted: Array<{ inReplyTo: string; text: string; link?: string }> = [];
  private mentionQueue: XMention[] = [];

  constructor(private readonly clock: () => number) {}

  seedTweet(
    tweet: Omit<XTweet, "tweetId" | "createdAtMs" | "likeCount"> & {
      tweetId?: string;
      createdAtMs?: number;
      likeCount?: number;
    },
  ): XTweet {
    const full: XTweet = {
      tweetId: tweet.tweetId ?? nextId(),
      createdAtMs: tweet.createdAtMs ?? this.clock(),
      likeCount: tweet.likeCount ?? 0,
      ...tweet,
    } as XTweet;
    this.tweets.set(full.tweetId, full);
    return full;
  }

  queueMention(mention: Omit<XMention, "mentionTweetId"> & { mentionTweetId?: string }): XMention {
    const full = { mentionTweetId: mention.mentionTweetId ?? nextId(), ...mention };
    this.mentionQueue.push(full);
    return full;
  }

  /** Sim controls. */
  failNextGets = 0; // simulate transient API failures (throw, not undefined)
  setLikes(tweetId: string, likes: number): void {
    const t = this.tweets.get(tweetId);
    if (!t) throw new Error(`no tweet ${tweetId}`);
    t.likeCount = likes;
  }
  deleteTweet(tweetId: string): void {
    this.tweets.delete(tweetId);
  }

  async fetchMentions(): Promise<XMention[]> {
    const batch = this.mentionQueue;
    this.mentionQueue = [];
    return batch;
  }

  async getTweet(tweetId: string): Promise<XTweet | undefined> {
    if (this.failNextGets > 0) {
      this.failNextGets -= 1;
      throw new Error("x api transient failure (simulated)");
    }
    return this.tweets.get(tweetId);
  }

  async postReply(opts: {
    inReplyTo: string;
    text: string;
    link?: string;
  }): Promise<{ tweetId: string }> {
    this.posted.push(opts);
    const cost = opts.link ? "$0.20" : "$0.015";
    console.log(
      `    [X:reply ${cost}] ↳${opts.inReplyTo}: ${opts.text}${opts.link ? ` ${opts.link}` : ""}`,
    );
    return { tweetId: nextId() };
  }
}
