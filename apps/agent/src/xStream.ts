/**
 * Push, not poll: X filtered stream delivers mentions the moment they
 * happen over one held-open connection. Steady-state API cost is ~zero —
 * you pay for delivered tags, not for asking.
 *
 * Shape: the stream fills an in-memory queue; a queue-backed XClient
 * wrapper hands the engine its mentions from there, so the engine still
 * just calls fetchMentions() and cannot tell push from poll. The ONLY
 * billed reads are one catch-up poll at boot and one after each stream
 * reconnect, to cover whatever happened while the pipe was down.
 */
import type { XClient, XMention, XTweet } from "./x.js";
import type { XApiClient } from "./xApi.js";

const STREAM_API = "https://api.twitter.com/2/tweets/search/stream";

interface StreamTweet {
  id: string;
  text: string;
  author_id?: string;
  referenced_tweets?: Array<{ type: string; id: string }>;
}
interface StreamEvent {
  data?: StreamTweet;
  includes?: { users?: Array<{ id: string; username: string }> };
}

/** Idempotently ensure exactly one rule: tweets mentioning the bot. */
export async function ensureStreamRule(bearer: string, botHandle: string): Promise<void> {
  const headers = { Authorization: `Bearer ${bearer}`, "content-type": "application/json" };
  const wanted = `@${botHandle}`;
  const res = await fetch(`${STREAM_API}/rules`, { headers });
  if (!res.ok) throw new Error(`stream rules read -> ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = (await res.json()) as { data?: Array<{ id: string; value: string }> };
  const rules = body.data ?? [];
  if (rules.some((r) => r.value === wanted)) return;
  // drop stale rules, add ours
  if (rules.length > 0) {
    await fetch(`${STREAM_API}/rules`, {
      method: "POST", headers,
      body: JSON.stringify({ delete: { ids: rules.map((r) => r.id) } }),
    });
  }
  const add = await fetch(`${STREAM_API}/rules`, {
    method: "POST", headers,
    body: JSON.stringify({ add: [{ value: wanted, tag: "mentions" }] }),
  });
  if (!add.ok) throw new Error(`stream rule add -> ${add.status}: ${(await add.text()).slice(0, 200)}`);
  console.log(`stream rule set: "${wanted}"`);
}

/**
 * XClient whose mention source is the stream queue. getTweet/postReply
 * pass through to the real API client (those are inherently on-demand).
 */
export class StreamedXClient implements XClient {
  private queue: XMention[] = [];
  /** True until the next fetchMentions: do one billed catch-up poll. */
  private needCatchUp = true;
  /** Catch-up cost guard: a flapping stream must not turn reconnect
   * catch-ups into a polling loop. One billed poll per window, max. */
  private lastCatchUpMs = 0;
  private static readonly CATCH_UP_MIN_INTERVAL_MS = 5 * 60 * 1000;
  private stopped = false;

  constructor(
    private readonly api: XApiClient,
    private readonly bearer: string,
    private readonly botUserId: string,
  ) {}

  start(): void {
    void this.runStream();
  }
  stop(): void {
    this.stopped = true;
  }

  private async runStream(): Promise<void> {
    let backoffMs = 30_000;
    while (!this.stopped) {
      try {
        const url =
          `${STREAM_API}?tweet.fields=author_id,referenced_tweets,text&expansions=author_id`;
        const res = await fetch(url, { headers: { Authorization: `Bearer ${this.bearer}` } });
        if (!res.ok || !res.body) {
          throw new Error(`stream connect -> ${res.status}: ${(await res.text()).slice(0, 200)}`);
        }
        console.log("mention stream connected");
        backoffMs = 5_000;
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let nl;
          while ((nl = buffer.indexOf("\n")) >= 0) {
            const line = buffer.slice(0, nl).trim();
            buffer = buffer.slice(nl + 1);
            if (!line) continue; // keep-alive
            this.handleLine(line);
          }
        }
        throw new Error("stream ended");
      } catch (err) {
        if (this.stopped) return;
        console.error(`mention stream dropped: ${(err as Error).message.slice(0, 150)} — reconnecting in ${backoffMs / 1000}s`);
        this.needCatchUp = true; // cover the gap with one billed poll
        await new Promise((r) => setTimeout(r, backoffMs));
        backoffMs = Math.min(backoffMs * 2, 600_000);
      }
    }
  }

  private handleLine(line: string): void {
    let ev: StreamEvent;
    try {
      ev = JSON.parse(line) as StreamEvent;
    } catch {
      return; // non-JSON keep-alive noise
    }
    const t = ev.data;
    if (!t) return;
    if (t.author_id === this.botUserId) return; // never react to our own posts
    const users = new Map((ev.includes?.users ?? []).map((u) => [u.id, u.username]));
    const ref = (t.referenced_tweets ?? []).find(
      (r) => r.type === "quoted" || r.type === "replied_to",
    );
    this.queue.push({
      mentionTweetId: t.id,
      authorId: t.author_id ?? "",
      authorHandle: users.get(t.author_id ?? "") ?? "",
      text: t.text,
      target: ref ? { tweetId: ref.id, type: ref.type as "quoted" | "replied_to" } : undefined,
    });
    console.log(`stream: mention ${t.id} queued`);
  }

  async fetchMentions(): Promise<XMention[]> {
    const out = this.queue;
    this.queue = [];
    if (this.needCatchUp && Date.now() - this.lastCatchUpMs >= StreamedXClient.CATCH_UP_MIN_INTERVAL_MS) {
      this.needCatchUp = false;
      this.lastCatchUpMs = Date.now();
      try {
        const polled = await this.api.fetchMentions();
        const seen = new Set(out.map((m) => m.mentionTweetId));
        out.push(...polled.filter((m) => !seen.has(m.mentionTweetId)));
      } catch (err) {
        this.needCatchUp = true; // retry the catch-up next tick
        console.error(`catch-up poll failed: ${(err as Error).message.slice(0, 120)}`);
      }
    }
    return out;
  }

  getTweet(tweetId: string): Promise<XTweet | undefined> {
    return this.api.getTweet(tweetId);
  }

  postReply(opts: { inReplyTo: string; text: string; link?: string }): Promise<{ tweetId: string }> {
    return this.api.postReply(opts);
  }
}
