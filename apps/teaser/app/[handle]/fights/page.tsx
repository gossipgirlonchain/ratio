/**
 * Screen 3: pick a fight. Eligibility is decided HERE against the 12h
 * parent-tweet rule (the score's 7d window is deliberately wider — the
 * score feels stable, this list feels urgent). Ineligible rows never
 * render; already-fought replies are dropped the same way.
 */

import Link from "next/link";
import { HandleForm } from "../../HandleForm";
import { FIGHT_WINDOW_MS } from "../../../lib/config";
import { marketsOnParent } from "../../../lib/markets";
import { mockX } from "../../../lib/mockX";
import { normalizeHandle } from "../../../lib/types";
import { FightList, FightRowData } from "./FightList";

export const dynamic = "force-dynamic";

export default async function FightsPage({ params }: { params: { handle: string } }) {
  const handle = normalizeHandle(decodeURIComponent(params.handle));
  const res = await mockX.lookup(handle);
  if (!res.ok)
    return (
      <>
        <p className="empty-note">couldn&apos;t load @{handle}.</p>
        <HandleForm initial={handle} />
      </>
    );

  const now = Date.now();
  const rows: FightRowData[] = res.replies
    .filter(
      (r) =>
        now - r.parent.createdAtMs < FIGHT_WINDOW_MS && // parent under 12h
        r.parent.replyCount >= 1 && // someone to fight
        marketsOnParent(r.parent.id, r.id).length === 0, // not already fought
    )
    .map((r) => ({
      replyId: r.id,
      kind: r.kind,
      parentHandle: r.parent.author.handle,
      parentAvatar: r.parent.author.avatarUrl,
      parentText: r.parent.text.split("\n")[0]!,
      myText: r.text,
      others: r.parent.replyCount,
      expiresAtMs: r.parent.createdAtMs + FIGHT_WINDOW_MS,
    }));

  return (
    <>
      <Link className="back" href={`/${handle}`}>← back to the card</Link>
      <div className="hero" style={{ margin: "4px 0 0" }}>
        <h1 style={{ fontSize: 22 }}>pick a fight, @{handle}</h1>
        <p>
          each of these can become a 24 hour market. most likes wins.
          eligibility dies 12h after the original tweet.
        </p>
      </div>
      <FightList handle={handle} rows={rows} />
      {rows.length === 0 && (
        <>
          <div className="section-note">score someone else</div>
          <HandleForm />
        </>
      )}
    </>
  );
}
