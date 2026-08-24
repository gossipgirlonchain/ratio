/**
 * The real XClient: X API v2 with OAuth 1.0a user context (the bot's
 * non-expiring token pair). Same seam the sim's mock fills — the engine
 * cannot tell them apart.
 *
 * THE CONTRACT THAT MATTERS (x.ts): getTweet returns undefined ONLY on
 * definitive unreadability (deleted / suspended / protected / blocked).
 * Everything transient — 429, 5xx, network, bad credentials — THROWS.
 * Getting this backwards forfeits markets on a rate limit; the mapping
 * below is deliberately conservative: only per-resource errors from a
 * 200 response count as gone.
 */
import { createHmac, randomBytes } from "node:crypto";

import type { RefType, XClient, XMention, XTweet } from "./x.js";

const API = "https://api.twitter.com/2";

export interface XApiCreds {
  apiKey: string;
  apiSecret: string;
  accessToken: string;
  accessSecret: string;
  /** The bot's own numeric X id (mentions timeline is per-user). */
  botUserId: string;
}

const pct = (s: string) =>
  encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/** OAuth 1.0a HMAC-SHA1; query params participate in the signature, a
 * JSON body does not (only form-encoded bodies would). */
function oauthHeader(
  creds: XApiCreds,
  method: string,
  url: string,
  query: Record<string, string>,
): string {
  const oauth: Record<string, string> = {
    oauth_consumer_key: creds.apiKey,
    oauth_nonce: randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_token: creds.accessToken,
    oauth_version: "1.0",
  };
  const all = { ...query, ...oauth };
  const paramString = Object.keys(all)
    .sort()
    .map((k) => `${pct(k)}=${pct(all[k]!)}`)
    .join("&");
  const base = [method.toUpperCase(), pct(url), pct(paramString)].join("&");
  const key = `${pct(creds.apiSecret)}&${pct(creds.accessSecret)}`;
  oauth.oauth_signature = createHmac("sha1", key).update(base).digest("base64");
  return (
    "OAuth " +
    Object.keys(oauth)
      .sort()
      .map((k) => `${pct(k)}="${pct(oauth[k]!)}"`)
      .join(", ")
  );
}

/** Per-resource error titles that mean the tweet is GONE, not flaky.
 * https://developer.twitter.com/en/support/twitter-api/error-troubleshooting */
const GONE_TITLES = new Set(["Not Found Error", "Authorization Error", "Forbidden"]);

interface V2Tweet {
  id: string;
  text: string;
  author_id?: string;
  created_at?: string;
  public_metrics?: { like_count?: number };
  referenced_tweets?: Array<{ type: string; id: string }>;
}
interface V2User {
  id: string;
  username: string;
}
interface V2Response<T> {
  data?: T;
  includes?: { users?: V2User[]; tweets?: V2Tweet[] };
  errors?: Array<{ title?: string; detail?: string; resource_id?: string }>;
  meta?: { newest_id?: string; result_count?: number };
}

const refOf = (t: V2Tweet): { type: RefType; tweetId: string } | undefined => {
  const r = (t.referenced_tweets ?? []).find(
    (x) => x.type === "quoted" || x.type === "replied_to",
  );
  return r ? { type: r.type as RefType, tweetId: r.id } : undefined;
};

export class XApiClient implements XClient {
  /** Newest mention seen: internal since_id cursor so steady-state polls
   * return (and bill for) only new mentions. Restart refetches the last
   * page; the store's mention idempotency absorbs the replay. */
  private newestMentionId: string | undefined;

  constructor(private readonly creds: XApiCreds) {}

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    query: Record<string, string> = {},
    body?: unknown,
  ): Promise<V2Response<T>> {
    const url = `${API}${path}`;
    const qs = new URLSearchParams(query).toString();
    const res = await fetch(qs ? `${url}?${qs}` : url, {
      method,
      headers: {
        Authorization: oauthHeader(this.creds, method, url, query),
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      // request-level failure is ALWAYS transient from the engine's view
      // (429 rate limit, 5xx, revoked creds): throw, never "gone".
      const detail = (await res.text()).slice(0, 300);
      throw new Error(`x api ${method} ${path} -> ${res.status}: ${detail}`);
    }
    return (await res.json()) as V2Response<T>;
  }

  async fetchMentions(sinceId?: string): Promise<XMention[]> {
    const since = sinceId ?? this.newestMentionId;
    const r = await this.request<V2Tweet[]>(
      "GET",
      `/users/${this.creds.botUserId}/mentions`,
      {
        max_results: "25",
        "tweet.fields": "author_id,referenced_tweets,text",
        expansions: "author_id",
        ...(since ? { since_id: since } : {}),
      },
    );
    if (r.meta?.newest_id) this.newestMentionId = r.meta.newest_id;
    const users = new Map((r.includes?.users ?? []).map((u) => [u.id, u.username]));
    // oldest first: the engine processes in arrival order
    return (r.data ?? [])
      .slice()
      .reverse()
      .map((t) => ({
        mentionTweetId: t.id,
        authorId: t.author_id ?? "",
        authorHandle: users.get(t.author_id ?? "") ?? "",
        text: t.text,
        target: refOf(t) ? { tweetId: refOf(t)!.tweetId, type: refOf(t)!.type } : undefined,
      }));
  }

  async getTweet(tweetId: string): Promise<XTweet | undefined> {
    const r = await this.request<V2Tweet>("GET", `/tweets/${tweetId}`, {
      "tweet.fields": "author_id,created_at,public_metrics,referenced_tweets,text",
      expansions: "author_id",
    });
    if (!r.data) {
      const titles = (r.errors ?? []).map((e) => e.title ?? "");
      if (titles.some((t) => GONE_TITLES.has(t))) return undefined; // definitively gone
      // 200 with no data and no recognised gone-error: treat as transient
      throw new Error(`x api tweet ${tweetId}: no data, errors=${titles.join(",") || "none"}`);
    }
    const t = r.data;
    const author = (r.includes?.users ?? []).find((u) => u.id === t.author_id);
    return {
      tweetId: t.id,
      authorId: t.author_id ?? "",
      authorHandle: author?.username ?? "",
      text: t.text,
      createdAtMs: t.created_at ? Date.parse(t.created_at) : 0,
      likeCount: t.public_metrics?.like_count ?? 0,
      referencedTweet: refOf(t),
    };
  }

  async postReply(opts: { inReplyTo: string; text: string; link?: string }): Promise<{ tweetId: string }> {
    const text = opts.link ? `${opts.text} ${opts.link}` : opts.text;
    const r = await this.request<{ id: string }>("POST", "/tweets", {}, {
      text,
      reply: { in_reply_to_tweet_id: opts.inReplyTo },
    });
    if (!r.data?.id) throw new Error("x api post: no id in response");
    return { tweetId: r.data.id };
  }
}
