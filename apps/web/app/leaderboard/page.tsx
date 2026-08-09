"use client";

/**
 * One combined board ranked on FEES EARNED — the heading says so, since a
 * cold visitor should not have to guess whether the number is volume,
 * winnings, or fees. The role breakdown is a proportion bar, not figures:
 * it is a character read, not accounting (exact amounts live on the
 * profile). Legend once at the top, never per row. Windows roll
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
      <h1 className="page-title">leaderboard · fees earned</h1>
      <div className="board-top">
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
        <div className="legend">
          <span><i className="swatch swatch-original" /> original</span>
          <span><i className="swatch swatch-reply" /> reply</span>
          <span><i className="swatch swatch-tagger" /> tagger</span>
        </div>
      </div>
      <div className="board">
        {rows.map((r, i) => {
          const total = r.byRole.original + r.byRole.reply + r.byRole.tagger || 1;
          return (
            <div className="card board-row" key={r.handle}>
              <span className="board-rank">{i + 1}</span>
              <img className="rs-avatar" src={`https://i.pravatar.cc/60?u=${r.handle}`} alt="" />
              <div className="board-main">
                <Link href={`/${r.handle}`}>@{r.handle}</Link>
                <div className="role-bar">
                  <i className="swatch-original" style={{ flexGrow: r.byRole.original / total }} />
                  <i className="swatch-reply" style={{ flexGrow: r.byRole.reply / total }} />
                  <i className="swatch-tagger" style={{ flexGrow: r.byRole.tagger / total }} />
                </div>
              </div>
              <span className="board-total">{fmtUsd(r.totalFeeUsd)}</span>
            </div>
          );
        })}
      </div>
    </main>
  );
}
