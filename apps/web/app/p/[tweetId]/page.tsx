"use client";

/**
 * Post page: every market on one post, stacked as individual strips.
 * Side A's tweet renders once as context. NO cross-market aggregation:
 * the count is a count, never a score.
 */
import Link from "next/link";
import { useParams } from "next/navigation";

import { MarketStrip } from "@ratio/ui";

import { marketsByPost } from "../../../lib/fixtures";
import { useMounted } from "../../../lib/useMounted";

export default function PostPage() {
  const mounted = useMounted();
  const params = useParams<{ tweetId: string }>();
  if (!mounted) return null;

  const list = marketsByPost(params.tweetId);
  if (list.length === 0) {
    return (
      <main className="page">
        <p className="page-empty">no markets on this post yet. <Link href="/">back to the feed</Link></p>
      </main>
    );
  }
  const post = list[0]!.data.a;

  return (
    <main className="page">
      <div className="card post-context">
        <img className="rs-avatar" src={post.avatarUrl} alt="" />
        <div>
          <span className="post-handle">@{post.handle}</span>
          <p>{post.text}</p>
        </div>
      </div>
      <p className="muted section-note">
        {list.length === 1 ? "1 market on this post" : `${list.length} markets on this post`}
      </p>
      <div className="timeline timeline-flush">
        {list.map((m) => (
          <MarketStrip
            key={m.data.marketId}
            data={m.data}
            onSign={(side, amount) => console.log(`sign: $${amount} on ${side}`)}
            marketHref={`/m/${m.data.marketId}`}
          />
        ))}
      </div>
    </main>
  );
}
