/**
 * Screen 2: the score card. No gate, no signup — the card IS the product
 * here. Empty states are results, not failures (a 0 LURKER card posts
 * fine; that's the joke landing, don't apologise for it).
 */

import Link from "next/link";
import { HandleForm } from "../HandleForm";
import { SITE_URL } from "../../lib/config";
import { fmt, compact, duration } from "../../lib/format";
import { mockX } from "../../lib/mockX";
import { computeScore, percentileFor } from "../../lib/score";
import { normalizeHandle } from "../../lib/types";
import { userPostIntent } from "../../lib/intents";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: { handle: string } }) {
  const handle = normalizeHandle(decodeURIComponent(params.handle));
  const img = `${SITE_URL}/api/card/score/${handle}`;
  return {
    title: `@${handle} reply score`,
    openGraph: { images: [img] },
    twitter: { card: "summary_large_image", images: [img] },
  };
}

export default async function ScorePage({ params }: { params: { handle: string } }) {
  const handle = normalizeHandle(decodeURIComponent(params.handle));
  const res = await mockX.lookup(handle);

  if (!res.ok) {
    return (
      <>
        <div className="card card-quiet">
          <p style={{ fontWeight: 800 }}>
            {res.reason === "private"
              ? `@${handle} is a private account. can't score what we can't see.`
              : `couldn't find @${handle}.`}
          </p>
          <p className="muted small" style={{ marginTop: 6 }}>
            typo? fix it below.
          </p>
        </div>
        {/* keep the input filled so a typo is a one-key fix */}
        <HandleForm initial={handle} autoFocus />
      </>
    );
  }

  const s = computeScore(res.replies);
  const pct = percentileFor(s.score);
  const scoreUrl = `${SITE_URL}/${handle}`;
  const shareText = `reply score ${fmt(s.score)}. ${
    s.score === 0 ? "lurker." : pct.label + "."
  }\n${scoreUrl}`;

  return (
    <>
      <div className="card score-card">
        <div className="score-head">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="score-avatar" src={res.user.avatarUrl} alt="" />
          <div className="score-who">
            <div className="score-name">{res.user.name}</div>
            <div className="score-handle">@{res.user.handle}</div>
          </div>
          <div className="tier-badge">{s.tier}</div>
        </div>

        <div className="h-label" style={{ marginTop: 18 }}>reply score</div>
        <div className="score-num">{fmt(s.score)}</div>
        <div className="score-pct">{s.score === 0 ? "flawless silence" : pct.label}</div>

        <div className="score-stats">
          <div>
            <div className="h-label">replies 7d</div>
            <div className="stat">{fmt(s.volume)}</div>
          </div>
          <div>
            <div className="h-label">avg reply time</div>
            <div className="stat">{s.volume ? duration(s.medianReplyS) : "n/a"}</div>
          </div>
          <div>
            <div className="h-label">most replied to</div>
            <div className="stat stat-wide">
              {s.mostRepliedTo ? `@${s.mostRepliedTo.handle} x${s.mostRepliedTo.count}` : "nobody"}
            </div>
          </div>
          <div>
            <div className="h-label">biggest room</div>
            <div className="stat stat-wide">
              {s.biggestRoom ? `@${s.biggestRoom.handle} ${compact(s.biggestRoom.replyCount)}` : "none"}
            </div>
          </div>
        </div>

        <div className="score-foot">
          <span className="brand">ratio</span>
          <span className="muted small">
            last 7 days · {new Date().toISOString().slice(0, 10)}
          </span>
        </div>
      </div>

      <div className="score-actions">
        <a className="btn" href={userPostIntent(shareText)} target="_blank" rel="noreferrer">
          post on x
        </a>
        <a className="btn btn-quiet" href={`/api/card/score/${handle}?dl=1`}>
          download card
        </a>
      </div>

      {res.replies.length > 0 ? (
        <Link className="btn btn-block" href={`/${handle}/fights`}>
          pick a fight →
        </Link>
      ) : (
        <>
          <p className="empty-note">
            zero replies in 7 days. the timeline never saw you coming, because you never came.
          </p>
          <div className="section-note">score someone else</div>
          <HandleForm />
        </>
      )}
    </>
  );
}
