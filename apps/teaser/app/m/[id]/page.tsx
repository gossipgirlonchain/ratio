/**
 * Screen 5: market created — and the page every share link lands on, so
 * it doubles as the public market view. The og:image is the LIVE market
 * card; the card carries the message, which is why every posted line of
 * copy stays short.
 */

import Link from "next/link";
import { CopyBlock } from "./CopyBlock";
import { SITE_URL } from "../../../lib/config";
import { userQuoteTweet } from "../../../lib/copy";
import { fmt, remaining } from "../../../lib/format";
import { userPostIntent, tweetUrl } from "../../../lib/intents";
import { getMarket, liveLikes, marketUrl } from "../../../lib/markets";

export const dynamic = "force-dynamic";

export function generateMetadata({ params }: { params: { id: string } }) {
  const img = `${SITE_URL}/api/card/market/${params.id}`;
  return {
    title: "market open",
    openGraph: { images: [img] },
    twitter: { card: "summary_large_image", images: [img] },
  };
}

export default function MarketPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { fresh?: string };
}) {
  const m = getMarket(params.id);
  if (!m)
    return (
      <>
        <p className="empty-note">no market here. it may have been created in a past life
          (the teaser store is in-memory).</p>
        <Link className="btn btn-block" href="/">start over</Link>
      </>
    );

  const likes = liveLikes(m);
  const link = marketUrl(m.id);
  const qt = userQuoteTweet(link);
  const fresh = searchParams.fresh === "1";

  return (
    <>
      {fresh && (
        <div className="hero" style={{ margin: "4px 0 0" }}>
          <h1 style={{ fontSize: 22 }}>market open.</h1>
          <p>the bot did its part. now post yours. the market needs eyes to move likes.</p>
        </div>
      )}

      <div className="card">
        <div className="market-vs">
          <div className="market-side">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="market-avatar" src={m.challenger.avatarUrl} alt="" />
            <span className="fight-handle">@{m.challenger.handle}</span>
            <span className="market-likes">{fmt(likes.challenger)}</span>
          </div>
          <span className="vs-mark">vs</span>
          <div className="market-side">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="market-avatar" src={m.mainchar.avatarUrl} alt="" />
            <span className="fight-handle">@{m.mainchar.handle}</span>
            <span className="market-likes">{fmt(likes.mainchar)}</span>
          </div>
        </div>
        <div className="market-clock">
          most likes in 24h wins · <b>{remaining(m.settlesAtMs - Date.now())}</b> on the clock
        </div>
      </div>

      {fresh && (
        <>
          <a
            className="btn btn-block"
            href={userPostIntent(qt, tweetUrl(m.challenger.handle, m.challenger.tweetId))}
            target="_blank"
            rel="noreferrer"
          >
            post this
          </a>
          <CopyBlock text={qt} />

          <div className="section-note">what the bot posted, under {m.botPost.repliedTo}</div>
          <div className="bot-log">
            <div className="bot-post">{m.botPost.text}</div>
          </div>
        </>
      )}

      {!fresh && (
        <p className="muted small" style={{ textAlign: "center" }}>
          settles {new Date(m.settlesAtMs).toLocaleString()} · started by @{m.challenger.handle}
        </p>
      )}
    </>
  );
}
