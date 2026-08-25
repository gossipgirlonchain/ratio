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

import { BOT_HANDLE } from "@ratio/config";
import { MarketStrip } from "@ratio/ui";

import { useAuth } from "../../lib/auth";
import { likeGapSince, marketById, marketsByParticipant, openPositionsFor, profileFor, useLive } from "../../lib/live";
import { useMounted } from "../../lib/useMounted";
import { useWallet } from "../../lib/wallet";

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
  const { wallet, send } = useWallet();
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
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
        <span className="head-balance">{wallet ? fmtUsd(wallet.balanceUsd) : "$0.00"}</span>
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
          <code className="deposit-address">{wallet ? wallet.address : "provisioning wallet…"}</code>
          <button
            className="copy-btn"
            disabled={!wallet}
            onClick={() => {
              if (!wallet) return;
              navigator.clipboard?.writeText(wallet.address);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? "copied" : "copy"}
          </button>
        </div>
      )}
      {openSection === "withdraw" && (
        <div className="head-wallet-detail head-wallet-send">
          <input
            className="rs-custom-input"
            placeholder="destination address"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
          <input
            className="rs-custom-input wallet-send-amount"
            placeholder="$"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
          />
          <button
            className="copy-btn"
            disabled={busy || !wallet}
            onClick={() => {
              const usd = Number(amount);
              if (!to || !Number.isFinite(usd) || usd <= 0) return;
              setBusy(true);
              setNote(null);
              void send(to.trim(), usd).then((r) => {
                setBusy(false);
                setNote(r.error ? r.error : `sent ${fmtUsd(usd)}`);
                if (!r.error) { setTo(""); setAmount(""); }
              });
            }}
          >
            {busy ? "sending…" : "send USDC"}
          </button>
          {note && <span className="wallet-pop-note">{note}</span>}
        </div>
      )}
    </div>
  );
}

export default function ProfilePage() {
  const mounted = useMounted();
  const params = useParams<{ handle: string }>();
  const router = useRouter();
  const { viewer, avatarUrl, login } = useAuth();
  const [tab, setTab] = useState<"live" | "history">("live");
  const world = useLive();
  if (!mounted) return null;

  const handle = decodeURIComponent(params.handle);
  const mine = marketsByParticipant(world, handle);
  const isOwn = viewer === handle;
  // YOUR profile always renders in full — wallet, zeroed record, empty
  // tabs — even before your first market. Strangers' empty profiles stay
  // a one-liner (permissionless profiles exist per market touched).
  if (mine.length === 0 && !isOwn) {
    return (
      <main className="page">
        <p className="page-empty">
          @{handle} has not been in a market yet. tag a reply and change that.
        </p>
      </main>
    );
  }
  const p = profileFor(world, handle);
  const open = mine.filter((m) => m.data.status === "open");
  const settled = mine.filter((m) => m.data.status !== "open");
  const roleTotal = p.feesByRole.original + p.feesByRole.reply + p.feesByRole.tagger || 1;
  const shown = tab === "live" ? open : settled;

  return (
    <main className="profile-wide">
      <header className="card profile-header">
        <img
          className="profile-avatar-lg"
          src={isOwn && avatarUrl ? avatarUrl : `https://unavatar.io/x/${handle}`}
          alt=""
        />
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
            <span>{fmtUsd0(openPositionsFor(world, handle).reduce((s, x) => s + x.netStakedUsd, 0))} in open battles</span>
            <span>{fmtUsd0(p.biggestMarketUsd)} biggest market</span>
            <span>{p.timesRatiod}x ratio&apos;d</span>
            <span>markets: {p.asOriginal} original · {p.asReply} reply · {p.asTagger} tagger</span>
          </div>
        </div>
        <WalletModule owner={viewer === handle} unclaimedUsd={p.unclaimedUsd} onLogin={login} />
      </header>

      {(() => {
        const positions = openPositionsFor(world, handle);
        if (positions.length === 0) return null;
        return (
          <div className="card profile-positions">
            <span className="section-note profile-positions-title">open battles</span>
            {positions.map((pos) => {
              const gap = likeGapSince(world, pos);
              const m = marketById(world, pos.marketId);
              if (!m) return null;
              const mine = pos.side === "a" ? m.data.a : m.data.b;
              const theirs = pos.side === "a" ? m.data.b : m.data.a;
              const leftMs = Math.max(0, m.data.settlesAtMs - Date.now());
              const leftH = Math.floor(leftMs / 3_600_000);
              const leftLabel = leftH > 0 ? `${leftH}h left` : `${Math.floor(leftMs / 60_000)}m left`;
              return (
                <Link className="mod-row profile-pos" href={`/m/${pos.marketId}`} key={pos.marketId + pos.side}>
                  <span className="mod-strong">@{pos.sideHandle} vs @{pos.otherHandle}</span>
                  <span className="mod-quiet">
                    {fmtUsd0(pos.netStakedUsd)} on @{pos.sideHandle} · {leftLabel}
                  </span>
                  <span className="mod-strong">
                    {mine.likes.toLocaleString("en-US")}–{theirs.likes.toLocaleString("en-US")}
                    {" "}{gap >= 0 ? "▲" : "▼"}
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
        <p className="page-empty">
          {isOwn && mine.length === 0
            ? `no markets yet. tag @${BOT_HANDLE} under a reply on x and your first one opens here.`
            : "nothing here yet."}
        </p>
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
