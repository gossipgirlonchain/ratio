"use client";

/**
 * Profile: one real header, not a list of cards. Identity, record, and
 * wallet merge into a single full-width header block; the content below
 * uses the full remaining width. Fees earned and the win record are the
 * headline; everything else is smaller. Role mix is the proportion bar
 * (same read as the leaderboard), never three figures. Live/history are
 * tabs, not stacked grey labels.
 */
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";

import { MarketStrip } from "@ratio/ui";

import { useAuth } from "../../lib/auth";
import { likeGapSince, marketsByParticipant, openPositionsFor, profileFor } from "../../lib/fixtures";
import { useMounted } from "../../lib/useMounted";

const DEMO_ADDRESS = "ratio1DemoWa11etAddre55Repl4cedByPrivyR4";

const fmtUsd = (n: number) =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtUsd0 = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

function WalletModule({
  owner,
  unclaimedUsd,
  onLogin,
}: {
  owner: boolean;
  unclaimedUsd: number;
  onLogin: () => void;
}) {
  const [openSection, setOpenSection] = useState<"deposit" | "withdraw" | null>(null);
  const [copied, setCopied] = useState(false);
  if (!owner) {
    return unclaimedUsd > 0 ? (
      <div className="head-wallet">
        <span className="head-unclaimed">{fmtUsd(unclaimedUsd)} unclaimed</span>
        <button className="claim-btn" onClick={onLogin}>
          log in with x to claim
        </button>
      </div>
    ) : null;
  }
  return (
    <div className="head-wallet">
      <div className="head-wallet-line">
        <span className="head-balance">$0.00</span>
        <button
          className={openSection === "deposit" ? "wallet-toggle wallet-toggle-on" : "wallet-toggle"}
          onClick={() => setOpenSection(openSection === "deposit" ? null : "deposit")}
        >
          deposit
        </button>
        <button
          className={openSection === "withdraw" ? "wallet-toggle wallet-toggle-on" : "wallet-toggle"}
          onClick={() => setOpenSection(openSection === "withdraw" ? null : "withdraw")}
        >
          withdraw
        </button>
      </div>
      {unclaimedUsd > 0 && <button className="claim-btn">claim {fmtUsd(unclaimedUsd)}</button>}
      {openSection === "deposit" && (
        <div className="head-wallet-detail">
          <code className="deposit-address">{DEMO_ADDRESS}</code>
          <button
            className="copy-btn"
            onClick={() => {
              navigator.clipboard?.writeText(DEMO_ADDRESS);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? "copied" : "copy"}
          </button>
        </div>
      )}
      {openSection === "withdraw" && (
        <div className="head-wallet-detail">
          <input className="rs-custom-input" placeholder="destination address" disabled />
          <button className="copy-btn" disabled>
            send
          </button>
        </div>
      )}
    </div>
  );
}

export default function ProfilePage() {
  const mounted = useMounted();
  const params = useParams<{ handle: string }>();
  const router = useRouter();
  const { viewer, login } = useAuth();
  const [tab, setTab] = useState<"live" | "history">("live");
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
  const roleTotal = p.feesByRole.original + p.feesByRole.reply + p.feesByRole.tagger || 1;
  const shown = tab === "live" ? open : settled;

  return (
    <main className="profile-wide">
      <header className="card profile-header">
        <img className="profile-avatar-lg" src={`https://i.pravatar.cc/96?u=${handle}`} alt="" />
        <div className="profile-main">
          <div className="profile-name-row">
            <h1>@{handle}</h1>
            <a className="profile-x" href={`https://x.com/${handle}`} target="_blank" rel="noreferrer">
              view on x
            </a>
          </div>
          <div className="profile-headline">
            <div>
              <span className="headline-num">{fmtUsd(p.feesEarnedUsd)}</span>
              <span className="headline-label">fees earned</span>
            </div>
            <div>
              <span className="headline-num">{p.wins}-{p.losses}</span>
              <span className="headline-label">record</span>
            </div>
            <div className="profile-rolebar">
              <div className="role-bar">
                <i className="swatch-original" style={{ flexGrow: p.feesByRole.original / roleTotal }} />
                <i className="swatch-reply" style={{ flexGrow: p.feesByRole.reply / roleTotal }} />
                <i className="swatch-tagger" style={{ flexGrow: p.feesByRole.tagger / roleTotal }} />
              </div>
              <span className="headline-label">original · reply · tagger</span>
            </div>
          </div>
          <div className="profile-secondary">
            <span>{fmtUsd0(p.volumeUsd)} volume</span>
            <span>{fmtUsd0(p.biggestMarketUsd)} biggest market</span>
            <span>{p.timesRatiod}x ratio&apos;d</span>
            <span>{p.asOriginal} as the original</span>
            <span>{p.asReply} as the reply</span>
            <span>{p.asTagger} tagged</span>
          </div>
        </div>
        <WalletModule owner={viewer === handle} unclaimedUsd={p.unclaimedUsd} onLogin={login} />
      </header>

      {(() => {
        const positions = openPositionsFor(handle);
        if (positions.length === 0) return null;
        return (
          <div className="card profile-positions">
            <span className="section-note profile-positions-title">currently backing</span>
            {positions.map((pos) => {
              const gap = likeGapSince(pos);
              return (
                <Link className="mod-row profile-pos" href={`/m/${pos.marketId}`} key={pos.marketId + pos.side}>
                  <span className="mod-strong">@{pos.sideHandle}</span>
                  <span className="mod-quiet">over @{pos.otherHandle} · {fmtUsd0(pos.netStakedUsd)}</span>
                  <span className="mod-strong">
                    {gap >= 0 ? "▲" : "▼"} {Math.abs(gap).toLocaleString("en-US")} likes
                  </span>
                </Link>
              );
            })}
          </div>
        );
      })()}

      <div className="tabs profile-tabs">
        <button className={tab === "live" ? "tab tab-on" : "tab"} onClick={() => setTab("live")}>
          live ({open.length})
        </button>
        <button className={tab === "history" ? "tab tab-on" : "tab"} onClick={() => setTab("history")}>
          history ({settled.length})
        </button>
      </div>

      {shown.length === 0 ? (
        <p className="page-empty">nothing here yet.</p>
      ) : (
        <div className="profile-strips">
          {shown.map((m) => (
            <MarketStrip key={m.data.marketId} data={m.data} marketHref={`/m/${m.data.marketId}`} onOpen={() => router.push(`/m/${m.data.marketId}`)} />
          ))}
        </div>
      )}
    </main>
  );
}
