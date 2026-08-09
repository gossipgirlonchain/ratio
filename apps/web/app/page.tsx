"use client";

/**
 * Home: two columns, the shape X uses. Markets left; condensed
 * leaderboard right, sticky — rank, avatar, handle, total only, linking
 * through to the full page. Strips unchanged.
 */
import Link from "next/link";

import { MarketStrip } from "@ratio/ui";

import { useAuth } from "../lib/auth";
import { leaderboard, markets } from "../lib/fixtures";
import { useMounted } from "../lib/useMounted";

const fmtUsd = (n: number) =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function Page() {
  const mounted = useMounted();
  const { viewer, login } = useAuth();
  if (!mounted) return null;
  return (
    <>
      <header className="masthead">
        <span className="wordmark">
          get <em>ratio&apos;d</em>
        </span>
        <span className="tag">the likes are the referee</span>
      </header>
      <div className="home-grid">
        <main className="timeline timeline-flush">
          {markets.map(({ data }) => (
            <MarketStrip
              key={data.marketId}
              data={data}
              onSign={(side, amount) => {
                // Point-of-action gate: reading is never gated, signing is.
                if (!viewer) {
                  login();
                  return false;
                }
                console.log(`sign: $${amount} backing ${side}`);
              }}
              onPresetUsed={(p) => console.log(`preset used: ${p}`)}
              marketHref={`/m/${data.marketId}`}
            />
          ))}
        </main>
        <aside className="home-side">
          <div className="card side-board">
            <h2>fees earned</h2>
            {leaderboard.all.slice(0, 5).map((r, i) => (
              <Link className="side-row" key={r.handle} href={`/${r.handle}`}>
                <span className="board-rank">{i + 1}</span>
                <img className="rs-avatar" src={`https://i.pravatar.cc/60?u=${r.handle}`} alt="" />
                <span className="side-handle">@{r.handle}</span>
                <span className="side-total">{fmtUsd(r.totalFeeUsd)}</span>
              </Link>
            ))}
            <Link className="side-more" href="/leaderboard">
              full leaderboard
            </Link>
          </div>
        </aside>
      </div>
    </>
  );
}
