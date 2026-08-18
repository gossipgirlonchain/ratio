"use client";

/**
 * Market page as a trading page (reference: the pump.fun coin page).
 * Centre: compact matchup header, then the chart as the hero.
 * Right rail, sticky: the trade panel — the reason the page exists —
 * with dense stat modules under it. No onboarding prose, no section
 * headers; every element earns its size.
 */
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo, useState } from "react";

import { quotePayout } from "@ratio/ui";

import { MarketChart, SIDE_A_COLOR, SIDE_B_COLOR } from "../../../components/MarketChart";
import { useAuth } from "../../../lib/auth";
import {
  chartSeries,
  marketById,
  openPositionsFor,
  positionFor,
  tradesByMarket,
} from "../../../lib/fixtures";
import { placeBet, usePendingBets } from "../../../lib/trade";
import { useMounted } from "../../../lib/useMounted";

const PRESETS = [1, 5, 25, 100, 250, 500] as const;

const fmtUsd = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
const fmtUsd2 = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtLikes = (n: number) => (n >= 1_000 ? `${(n / 1_000).toFixed(1)}K` : String(n));

const timeLeft = (settlesAtMs: number): string => {
  const ms = Math.max(0, settlesAtMs - Date.now());
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};

export default function MarketPage() {
  const mounted = useMounted();
  const params = useParams<{ id: string }>();
  const { viewer, login } = useAuth();
  const [backing, setBacking] = useState<"a" | "b" | null>(null);
  const [amount, setAmount] = useState<number | null>(null);
  const [custom, setCustom] = useState<string | null>(null);

  const market = marketById(params.id);
  const pending = usePendingBets(params.id);
  const series = useMemo(
    () => (market ? chartSeries(market) : null),
    [market],
  );
  if (!mounted) return null;
  if (!market || !series) {
    return (
      <main className="page">
        <p className="page-empty">no market here. <Link href="/">back to the feed</Link></p>
      </main>
    );
  }
  const { data } = market;
  const open = data.status === "open";
  const position = positionFor(viewer, data.marketId);

  // Optimistic layer: pending bets fold into every number BEFORE the
  // chain answers. Failure removes them and the numbers roll back.
  const live = pending.filter((b) => b.state !== "failed");
  const failed = pending.find((b) => b.state === "failed");
  const pendUsd = (side: "a" | "b") =>
    live.filter((b) => b.side === side).reduce((s, b) => s + b.amountUsd, 0);
  const potA = data.a.potUsd + pendUsd("a");
  const potB = data.b.potUsd + pendUsd("b");
  const trades = (tradesByMarket[data.marketId] ?? []).sort((x, y) => y.amountUsd - x.amountUsd);
  const myEntries = viewer
    ? [
        ...openPositionsFor(viewer)
          .filter((p) => p.marketId === data.marketId)
          .map((p) => ({ atMs: p.enteredAtMs, side: p.side })),
        ...live.map((b) => ({ atMs: b.atMs, side: b.side })),
      ]
    : [];
  const quote =
    backing && amount
      ? quotePayout({
          stakeUsd: amount,
          potAUsd: potA,
          potBUsd: potB,
          yourSideUsd: (backing === "a" ? { potUsd: potA } : { potUsd: potB }).potUsd,
        })
      : null;
  const sign = () => {
    if (!backing || !amount) return;
    if (!viewer) {
      login();
      return;
    }
    // Optimistic: placed NOW, reconciled when the chain answers.
    placeBet({ marketId: data.marketId, side: backing, amountUsd: amount });
    setBacking(null);
    setAmount(null);
    setCustom(null);
  };

  return (
    <div className="market-grid">
      <main className="market-centre">
        <div className="match-head card">
          {(["a", "b"] as const).map((who) => {
            const side = who === "a" ? data.a : data.b;
            const leading =
              data.status === "settled" && data.winner
                ? data.winner === who
                : (who === "a") === (data.a.likes >= data.b.likes);
            const on = open && backing === who;
            const rowClass = [
              "match-row",
              open ? "match-row-tap" : "",
              on ? "match-row-on" : "",
            ].join(" ").trim();
            return (
              // The tweets ARE buttons (strip law: rows are the controls):
              // tapping one picks that side in the trade panel; same state,
              // two surfaces. Handle links still navigate, nothing else.
              <div
                className={rowClass}
                key={who}
                role={open ? "button" : undefined}
                tabIndex={open ? 0 : undefined}
                onClick={() => {
                  if (!open) return;
                  setBacking(backing === who ? null : who);
                  setAmount(null);
                  setCustom(null);
                }}
                onKeyDown={(e) => {
                  if (open && (e.key === "Enter" || e.key === " ")) {
                    e.preventDefault();
                    setBacking(backing === who ? null : who);
                    setAmount(null);
                    setCustom(null);
                  }
                }}
              >
                {/* the ring IS the chart key — same hue as the side's line */}
                <img
                  className="rs-avatar match-avatar"
                  style={{ borderColor: who === "a" ? SIDE_A_COLOR : SIDE_B_COLOR }}
                  src={side.avatarUrl}
                  alt=""
                />
                <div className="match-body">
                  <Link
                    href={`/${side.handle}`}
                    className="match-handle"
                    onClick={(e) => e.stopPropagation()}
                  >
                    @{side.handle}
                  </Link>
                  <p className="match-text">{side.text}</p>
                </div>
                <span className={leading ? "match-likes match-likes-lead" : "match-likes"}>
                  ♥ {fmtLikes(side.likes)}
                </span>
              </div>
            );
          })}
          <div className="match-rule">
            {data.status === "settled" && data.winner
              ? `@${(data.winner === "a" ? data.a : data.b).handle} won`
              : data.status === "forfeited" && data.winner
                ? `@${(data.winner === "a" ? data.a : data.b).handle} wins by forfeit`
                : `most likes in ${timeLeft(data.settlesAtMs)} wins`}
            <span className="match-staked">{fmtUsd(potA + potB)} staked</span>
          </div>
        </div>

        <div className="card chart-card">
          <MarketChart series={series} handleA={data.a.handle} handleB={data.b.handle} markers={myEntries} />
        </div>

        {/* trades live under the chart — that is where people look.
            Sells are trades too: shown signed, newest first. */}
        <div className="card mod centre-trades">
          {live.map((b) => (
            <div className="mod-row" key={b.id}>
              <span>@{viewer}</span>
              <span className="mod-quiet">on @{b.side === "a" ? data.a.handle : data.b.handle}</span>
              <span className="mod-strong">
                {fmtUsd(b.amountUsd)}{b.state === "confirming" ? " · confirming" : " ✓"}
              </span>
            </div>
          ))}
          {trades.length === 0 && live.length === 0 ? (
            <div className="mod-row"><span className="mod-quiet">nobody in yet</span></div>
          ) : (
            [...trades]
              .sort((x, y) => y.atMs - x.atMs)
              .map((t) => (
                <div className="mod-row" key={t.handle + t.amountUsd + t.atMs}>
                  <Link href={`/${t.handle}`}>@{t.handle}</Link>
                  <span className="mod-quiet">
                    {t.direction === "sell" ? "sold" : "on"} @{t.side === "a" ? data.a.handle : data.b.handle}
                  </span>
                  <span className="mod-strong">
                    {t.direction === "sell" ? `−${fmtUsd(t.amountUsd)}` : fmtUsd(t.amountUsd)}
                  </span>
                </div>
              ))
          )}
        </div>
      </main>

      <aside className="market-rail">
        <div className="card trade-panel">
          {/* Buy-only by PROTOCOL: the prediction hook rejects every sell,
              confirmed by Doppler. Positions lock from purchase to claim —
              no tabs, no sell view, ever. */}
          <div className="trade-sides">
            {(["a", "b"] as const).map((who) => {
              const side = who === "a" ? data.a : data.b;
              return (
                <button
                  key={who}
                  className={backing === who ? "trade-side trade-side-on" : "trade-side"}
                  disabled={!open}
                  onClick={() => {
                    setBacking(backing === who ? null : who);
                    setAmount(null);
                    setCustom(null);
                  }}
                >
                  @{side.handle}
                </button>
              );
            })}
          </div>
          {open && (
            <>
              <div className="rs-presets">
                {PRESETS.map((p) => (
                  <button
                    key={p}
                    className={amount === p && custom === null ? "rs-preset rs-preset-on" : "rs-preset"}
                    onClick={() => {
                      setAmount(p);
                      setCustom(null);
                    }}
                  >
                    ${p}
                  </button>
                ))}
              </div>
              <div className="buy-custom-row">
                {custom === null ? (
                  <button
                    className="rs-custom-btn"
                    onClick={() => {
                      setCustom("");
                      setAmount(null);
                    }}
                  >
                    Custom
                  </button>
                ) : (
                  <input
                    className="rs-custom-input"
                    inputMode="decimal"
                    autoFocus
                    placeholder="$0"
                    value={custom}
                    onChange={(e) => {
                      const raw = e.target.value.replace(/[^0-9.]/g, "");
                      setCustom(raw);
                      const v = Number(raw);
                      setAmount(v > 0 ? v : null);
                    }}
                    onBlur={() => {
                      if (!custom) setCustom(null);
                    }}
                  />
                )}
              </div>
              {/* Full width: the outcome fits ON the button, no truncation,
                  no separate payout line. */}
              <button
                className={amount && backing ? "rs-sign rs-sign-on buy-sign" : "rs-sign buy-sign"}
                disabled={!amount || !backing}
                onClick={sign}
              >
                {quote && backing
                  ? `Sign · $${quote.payoutUsd.toFixed(2)} if @${(backing === "a" ? data.a : data.b).handle} wins`
                  : "Sign"}
              </button>
            </>
          )}
          {failed && (
            <div className="mod-row position-mod trade-failed">
              <span>did not go through: {failed.reason}. nothing was taken.</span>
            </div>
          )}
          {(position || live.length > 0) && (
            <div className="position-mod">
              {position && (
                <div className="mod-row">
                  <span className="mod-quiet">
                    your position · locked until settlement
                  </span>
                  <span className="mod-strong">
                    {position.tokens.toLocaleString()} on @{position.side === "a" ? data.a.handle : data.b.handle}
                  </span>
                </div>
              )}
              {live.map((b) => (
                <div className="mod-row" key={b.id}>
                  <span className="mod-quiet">
                    {b.state === "confirming" ? "confirming on chain" : "placed ✓"}
                  </span>
                  <span className="mod-strong">
                    {fmtUsd(b.amountUsd)} on @{b.side === "a" ? data.a.handle : data.b.handle}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card mod">
          <div className="mod-row">
            <span className="mod-quiet">staked</span>
            <span className="mod-strong">{fmtUsd(potA + potB)}</span>
          </div>
          <div className="mod-row">
            <span className="mod-quiet">settles</span>
            <span className="mod-strong">
              {data.status === "open" ? `in ${timeLeft(data.settlesAtMs)}` : "closed"}
            </span>
          </div>
          <div className="mod-row">
            <span className="mod-quiet">post</span>
            <Link href={`/p/${market.postId}`}>all markets on it</Link>
          </div>
        </div>
      </aside>
    </div>
  );
}
