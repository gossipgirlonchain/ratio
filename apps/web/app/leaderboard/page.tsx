"use client";

/**
 * One combined board ranked on total fees earned, never three boards by
 * role. The per-role breakdown under each row is the character read:
 * mostly-original gets dunked on constantly, mostly-tagger is a market
 * maker, same rank and a completely different story. Windows roll
 * continuously; no clock resets.
 */
import Link from "next/link";
import { useState } from "react";

import { leaderboard } from "../../lib/fixtures";
import { useMounted } from "../../lib/useMounted";

const WINDOWS = [
  { key: "all", label: "all time" },
  { key: "week", label: "7 days" },
  { key: "day", label: "24 hours" },
] as const;

const fmtUsd = (n: number) =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function LeaderboardPage() {
  const mounted = useMounted();
  const [win, setWin] = useState<(typeof WINDOWS)[number]["key"]>("all");
  if (!mounted) return null;
  const rows = leaderboard[win];

  return (
    <main className="page">
      <h1 className="page-title">leaderboard</h1>
      <div className="tabs">
        {WINDOWS.map((w) => (
          <button
            key={w.key}
            className={win === w.key ? "tab tab-on" : "tab"}
            onClick={() => setWin(w.key)}
          >
            {w.label}
          </button>
        ))}
      </div>
      <div className="board">
        {rows.map((r, i) => (
          <div className="card board-row" key={r.handle}>
            <span className="board-rank">{i + 1}</span>
            <img className="rs-avatar" src={`https://i.pravatar.cc/60?u=${r.handle}`} alt="" />
            <div className="board-main">
              <Link href={`/${r.handle}`}>@{r.handle}</Link>
              <span className="muted board-roles">
                {fmtUsd(r.byRole.original)} original · {fmtUsd(r.byRole.reply)} reply · {fmtUsd(r.byRole.tagger)} tagger
              </span>
            </div>
            <span className="board-total">{fmtUsd(r.totalFeeUsd)}</span>
          </div>
        ))}
      </div>
    </main>
  );
}
