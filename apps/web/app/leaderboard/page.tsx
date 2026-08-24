"use client";

/**
 * TWO boards, one window switcher. "top traders" ranks the people GOOD AT
 * BETTING (wins, win rate, profit — so a visitor can find someone worth
 * copying and click through to what they back now). "fees earned" ranks
 * the people BEING BET ON. Different populations, never merged. Headings
 * say exactly what the number is; role breakdown stays a proportion bar
 * (character read, not accounting). Windows roll continuously.
 */
import Link from "next/link";
import { useState } from "react";

import { leaderboard, traderBoard } from "../../lib/fixtures";
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
  const traders = traderBoard(win);

  return (
    <main className="page page-boards">
      <h1 className="page-title">leaderboard</h1>
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
      </div>

      <div className="board-duo">
      <section>
      <h2 className="board-heading">top traders · profit</h2>
      <div className="board">
        {traders.length === 0 ? (
          <p className="page-empty">no settled bets in this window yet.</p>
        ) : (
          traders.map((t, i) => (
            <div className="card board-row" key={t.handle}>
              <span className="board-rank">{i + 1}</span>
              <img className="rs-avatar" src={`https://i.pravatar.cc/60?u=${t.handle}`} alt="" />
              <div className="board-main">
                <Link href={`/${t.handle}`}>@{t.handle}</Link>
                <span className="board-sub">
                  {t.wins}-{t.losses} · {Math.round(t.winRate * 100)}% win rate
                </span>
              </div>
              <span className="board-total">
                {t.profitUsd >= 0 ? "+" : "−"}{fmtUsd(Math.abs(t.profitUsd))}
              </span>
            </div>
          ))
        )}
      </div>

      </section>
      <section>
      {/* legend shares the heading line so both columns' first cards
          sit at the same height */}
      <div className="board-head-row">
        <h2 className="board-heading">fees earned</h2>
        <div className="legend board-legend">
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
      </section>
      </div>
    </main>
  );
}
