/**
 * Screen 4: pick your opponent. Everyone else on the same parent tweet.
 * One tap = market. The whole row is the submit button.
 */

import Link from "next/link";
import { pickOpponent } from "../../../actions";
import { FIGHT_WINDOW_MS } from "../../../../lib/config";
import { compact } from "../../../../lib/format";
import { existingMarketForPair } from "../../../../lib/markets";
import { mockX } from "../../../../lib/mockX";
import { normalizeHandle } from "../../../../lib/types";

export const dynamic = "force-dynamic";

export default async function OpponentPage({
  params,
}: {
  params: { handle: string; replyId: string };
}) {
  const handle = normalizeHandle(decodeURIComponent(params.handle));
  const replyId = decodeURIComponent(params.replyId);
  const res = await mockX.lookup(handle);
  const reply = res.ok ? res.replies.find((r) => r.id === replyId) : undefined;

  if (!res.ok || !reply || Date.now() - reply.parent.createdAtMs > FIGHT_WINDOW_MS)
    return (
      <>
        <p className="empty-note">this one&apos;s gone. tweets have to be under 12h.</p>
        <Link className="btn btn-block" href={`/${handle}/fights`}>back to the list</Link>
      </>
    );

  const opponents = (await mockX.opponents(reply.parent.id, handle)).filter(
    (o) => !existingMarketForPair(reply.id, o.tweetId),
  );

  return (
    <>
      <Link className="back" href={`/${handle}/fights`}>← other fights</Link>
      <div className="card card-quiet fight-row">
        <div className="fight-parent">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="fight-avatar" src={reply.parent.author.avatarUrl} alt="" />
          <div className="fight-body">
            <span className="fight-handle">@{reply.parent.author.handle}</span>
            <div className="fight-text">{reply.parent.text}</div>
          </div>
        </div>
        <div className="fight-mine">{reply.text}</div>
      </div>

      <div className="section-note">pick your opponent. most likes in 24h wins.</div>

      {opponents.length === 0 ? (
        <p className="empty-note">everyone here is already in a market. fast thread.</p>
      ) : (
        opponents.map((o) => (
          <form action={pickOpponent} key={o.tweetId}>
            <input type="hidden" name="handle" value={handle} />
            <input type="hidden" name="replyId" value={reply.id} />
            <input type="hidden" name="opponentTweetId" value={o.tweetId} />
            <button className="opp-row" type="submit">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="fight-avatar" src={o.author.avatarUrl} alt="" />
              <div className="fight-body">
                <span className="fight-handle">@{o.author.handle}</span>
                <div className="fight-text">{o.text}</div>
              </div>
              <span className="opp-likes">{compact(o.likes)} ♥</span>
            </button>
          </form>
        ))
      )}
    </>
  );
}
