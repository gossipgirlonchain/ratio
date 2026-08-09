"use client";

/**
 * Profile page: permissionless. Exists for every X account that has ever
 * been in a market, signed up or not, no opt-out, indexable. This is also
 * the claim page for the account's owner; there is no separate dashboard.
 * The public unclaimed balance is the acquisition hook, deliberately.
 */
import Link from "next/link";
import { useParams } from "next/navigation";

import { MarketStrip } from "@ratio/ui";

import { marketsByParticipant, profileFor } from "../../lib/fixtures";
import { useMounted } from "../../lib/useMounted";

const fmtUsd = (n: number) =>
  `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

export default function ProfilePage() {
  const mounted = useMounted();
  const params = useParams<{ handle: string }>();
  if (!mounted) return null;

  const handle = decodeURIComponent(params.handle);
  const mine = marketsByParticipant(handle);
  if (mine.length === 0) {
    return (
      <main className="page">
        <p className="page-empty">
          @{handle} has not been in a market yet. tag a reply and change that.
        </p>
      </main>
    );
  }
  const p = profileFor(handle);
  const open = mine.filter((m) => m.data.status === "open");
  const settled = mine.filter((m) => m.data.status !== "open");

  return (
    <main className="page">
      <header className="profile-head card">
        <img className="profile-avatar" src={`https://i.pravatar.cc/60?u=${handle}`} alt="" />
        <div className="profile-id">
          <h1>@{handle}</h1>
          <a className="muted" href={`https://x.com/${handle}`} target="_blank" rel="noreferrer">
            view on x
          </a>
        </div>
        {p.unclaimedUsd > 0 && (
          <div className="profile-claim">
            <span className="profile-unclaimed">{fmtUsd(p.unclaimedUsd)} unclaimed</span>
            <button className="claim-btn">log in with x to claim</button>
          </div>
        )}
      </header>

      <section className="card">
        <h2>record</h2>
        <div className="stat-grid">
          <div><span className="stat">{p.wins}-{p.losses}</span><span className="muted">win record</span></div>
          <div><span className="stat">{fmtUsd(p.volumeUsd)}</span><span className="muted">volume generated</span></div>
          <div><span className="stat">{fmtUsd(p.biggestMarketUsd)}</span><span className="muted">biggest market</span></div>
          <div><span className="stat">{p.timesRatiod}</span><span className="muted">times ratio&apos;d</span></div>
          <div><span className="stat">{p.asOriginal}</span><span className="muted">as the original</span></div>
          <div><span className="stat">{p.asReply}</span><span className="muted">as the reply</span></div>
          <div><span className="stat">{p.asTagger}</span><span className="muted">as tagger</span></div>
          <div><span className="stat">{fmtUsd(p.feesEarnedUsd)}</span><span className="muted">fees earned</span></div>
        </div>
        <p className="muted role-line">
          fees by role: {fmtUsd(p.feesByRole.original)} original · {fmtUsd(p.feesByRole.reply)} reply · {fmtUsd(p.feesByRole.tagger)} tagger
        </p>
      </section>

      {open.length > 0 && (
        <>
          <p className="muted section-note">live now</p>
          <div className="timeline timeline-flush">
            {open.map((m) => (
              <MarketStrip key={m.data.marketId} data={m.data} marketHref={`/m/${m.data.marketId}`} />
            ))}
          </div>
        </>
      )}

      {settled.length > 0 && (
        <>
          <p className="muted section-note">history</p>
          <div className="timeline timeline-flush">
            {settled.map((m) => (
              <MarketStrip key={m.data.marketId} data={m.data} />
            ))}
          </div>
        </>
      )}

      <p className="page-empty">
        <Link href="/leaderboard">see where @{handle} ranks</Link>
      </p>
    </main>
  );
}
