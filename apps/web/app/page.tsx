"use client";

/**
 * Home: two columns, the shape X uses. Markets left; condensed
 * leaderboard right, sticky — rank, avatar, handle, total only, linking
 * through to the full page. Strips unchanged.
 */
import { usePrivy } from "@privy-io/react-auth";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { MarketStrip } from "@ratio/ui";

import { useAuth } from "../lib/auth";
import { feedMarkets, useLive } from "../lib/live";
import { placeBet, usePendingBets } from "../lib/trade";
import { useMounted } from "../lib/useMounted";

const fmtUsd = (n: number) =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function Page() {
  const mounted = useMounted();
  const router = useRouter();
  const { viewer, login } = useAuth();
  const { getAccessToken, authenticated } = usePrivy();
  const live = useLive();
  const pendingBets = usePendingBets();
  if (!mounted) return null;
  const markets = feedMarkets(live);
  const leaders = live.leaderboard.slice(0, 5);
  return (
    <>
      <div className="home-grid">
        <main className="timeline timeline-flush">
          {!live.loading && markets.length === 0 && (
            <p className="page-empty">no markets yet. tag @ratiowtf under a reply or QT to open the first one.</p>
          )}
          {markets.map(({ data }) => (
            <MarketStrip
              key={data.marketId}
              data={data}
              betStatus={pendingBets.filter((b) => b.marketId === data.marketId).at(-1) ?? null}
              onSign={(side, amount) => {
                // Point-of-action gate: reading is never gated, signing is.
                if (!viewer) {
                  login();
                  return false;
                }
                placeBet({ marketId: data.marketId, side, amountUsd: amount, auth: authenticated ? getAccessToken : undefined });
              }}
              onPresetUsed={(p) => console.log(`preset used: ${p}`)}
              marketHref={`/m/${data.marketId}`}
              onOpen={() => router.push(`/m/${data.marketId}`)}
            />
          ))}
        </main>
        <aside className="home-side">
          <div className="card side-board">
            <h2>fees earned</h2>
            {leaders.length === 0 && <p className="side-empty">no fees earned yet</p>}
            {leaders.map((r, i) => (
              <Link className="side-row" key={r.handle} href={`/${r.handle}`}>
                <span className="board-rank">{i + 1}</span>
                <img className="rs-avatar" src={`https://unavatar.io/x/${r.handle}`} alt="" />
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
