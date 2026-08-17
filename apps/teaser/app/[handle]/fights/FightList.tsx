"use client";

/**
 * Screen 3's list body. Client-side so the per-row countdown ticks and a
 * row that crosses the 12h line disappears live — hidden, never greyed
 * (spec). The list is replies + QTs mixed, newest first, as delivered.
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import { remaining } from "../../../lib/format";

export interface FightRowData {
  replyId: string;
  kind: "reply" | "quote";
  parentHandle: string;
  parentAvatar: string;
  parentText: string; // first line only, pre-trimmed
  myText: string;
  others: number;
  expiresAtMs: number;
}

export function FightList({ handle, rows }: { handle: string; rows: FightRowData[] }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const live = rows.filter((r) => r.expiresAtMs > now);
  if (live.length === 0)
    return (
      <p className="empty-note">nothing live right now. reply to something and come back.</p>
    );

  return (
    <>
      {live.map((r) => (
        <div className="card card-quiet fight-row" key={r.replyId}>
          <div className="fight-parent">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="fight-avatar" src={r.parentAvatar} alt="" />
            <div className="fight-body">
              <span className="fight-handle">@{r.parentHandle}</span>
              <div className="fight-text">{r.parentText}</div>
            </div>
          </div>
          <div className="fight-mine">
            {r.kind === "quote" ? <span className="h-label">qt · </span> : null}
            {r.myText}
          </div>
          <div className="fight-foot">
            <span className="fight-meta">
              {r.others} other{r.others === 1 ? "" : "s"} in the thread
            </span>
            <span className="fight-meta fight-clock">{remaining(r.expiresAtMs - now)} left</span>
            <Link className="btn" href={`/${handle}/fight/${encodeURIComponent(r.replyId)}`}>
              pick this fight
            </Link>
          </div>
        </div>
      ))}
    </>
  );
}
