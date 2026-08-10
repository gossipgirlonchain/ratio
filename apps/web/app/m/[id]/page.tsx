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
  positionFor,
  tradesByMarket,
} from "../../../lib/fixtures";
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
  const [tab, setTab] = useState<"buy" | "sell">("buy");
  const [backing, setBacking] = useState<"a" | "b" | null>(null);
  const [amount, setAmount] = useState<number | null>(null);
  const [custom, setCustom] = useState<string | null>(null);
  const [sellFrac, setSellFrac] = useState<25 | 50 | 100>(100);

  const market = marketById(params.id);
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
  const trades = (tradesByMarket[data.marketId] ?? []).sort((x, y) => y.amountUsd - x.amountUsd);
  const position = positionFor(viewer, data.marketId);
  const quote =
    backing && amount
      ? quotePayout({
          stakeUsd: amount,
          potAUsd: data.a.potUsd,
          potBUsd: data.b.potUsd,
          yourSideUsd: (backing === "a" ? data.a : data.b).potUsd,
        })
      : null;
  // DEMO ramp display only — the real shape is undecided (config TODO).
  const elapsed = 1 - Math.max(0, data.settlesAtMs - Date.now()) / (24 * 3_600_000);
  const exitFeePct = Math.round(75 * Math.max(0, Math.min(1, elapsed)));

  const sign = () => {
    if (!backing || !amount) return;
    if (!viewer) {
      login();
      return;
    }
    console.log(`sign: $${amount} on ${backing}`);
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
            return (
              <div className="match-row" key={who}>
                {/* the ring IS the chart key — same hue as the side's line */}
                <img
                  className="rs-avatar match-avatar"
                  style={{ borderColor: who === "a" ? SIDE_A_COLOR : SIDE_B_COLOR }}
                  src={side.avatarUrl}
                  alt=""
                />
                <div className="match-body">
                  <Link href={`/${side.handle}`} className="match-handle">
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
              : data.status === "voided"
                ? "voided · stakes refunded"
                : `most likes in ${timeLeft(data.settlesAtMs)} wins`}
            <span className="match-staked">{fmtUsd(data.a.potUsd + data.b.potUsd)} staked</span>
          </div>
        </div>

        <div className="card chart-card">
          <MarketChart series={series} handleA={data.a.handle} handleB={data.b.handle} />
        </div>

        {/* trades live under the chart — that is where people look.
            Sells are trades too: shown signed, newest first. */}
        <div className="card mod centre-trades">
          {trades.length === 0 ? (
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
          {open && (
            <div className="panel-tabs">
              <button className={tab === "buy" ? "panel-tab panel-tab-on" : "panel-tab"} onClick={() => setTab("buy")}>
                Buy
              </button>
              <button className={tab === "sell" ? "panel-tab panel-tab-on" : "panel-tab"} onClick={() => setTab("sell")}>
                Sell
              </button>
            </div>
          )}
          {tab === "buy" && (
          <>
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
              <div className="rs-sign-row">
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
                {/* The outcome lives ON the button — no separate payout
                    line, nothing to jump. */}
                <button className={amount && backing ? "rs-sign rs-sign-on" : "rs-sign"} disabled={!amount || !backing} onClick={sign}>
                  {quote && backing
                    ? `sign · $${quote.payoutUsd.toFixed(2)} if @${(backing === "a" ? data.a : data.b).handle} wins`
                    : "sign"}
                </button>
              </div>
            </>
          )}
          </>
          )}

          {tab === "sell" && open && (
            <div className="sell-tab">
              {position ? (
                (() => {
                  const posHandle = position.side === "a" ? data.a.handle : data.b.handle;
                  const frac = sellFrac / 100;
                  const gross = position.netStakedUsd * 0.96 * frac; // demo curve value
                  const feeUsd = gross * (exitFeePct / 100);
                  const net = gross - feeUsd;
                  const ifWins = quotePayout({
                    stakeUsd: position.netStakedUsd,
                    potAUsd: data.a.potUsd - (position.side === "a" ? position.netStakedUsd : 0),
                    potBUsd: data.b.potUsd - (position.side === "b" ? position.netStakedUsd : 0),
                    yourSideUsd:
                      (position.side === "a" ? data.a.potUsd : data.b.potUsd) - position.netStakedUsd,
                  }).payoutUsd;
                  return (
                    <>
                      {/* the number being decided on — the largest thing here */}
                      <div className="sell-now">
                        <span className="sell-now-num">{fmtUsd2(net)}</span>
                        <span className="sell-now-label">you get, after the exit fee</span>
                      </div>
                      {/* the fee is the most consequential number: rate AND dollars */}
                      <div className="exit-fee-callout">
                        exit fee {exitFeePct}% · −{fmtUsd2(feeUsd)}
                      </div>
                      <div className="mod-row">
                        <span className="mod-quiet">position</span>
                        <span className="mod-strong">
                          {position.tokens.toLocaleString()} on @{posHandle}
                        </span>
                      </div>
                      <div className="mod-row">
                        <span className="mod-quiet trunc">if @{posHandle} wins</span>
                        <span className="mod-strong">{fmtUsd2(ifWins)}</span>
                      </div>
                      <div className="sell-fracs">
                        {([25, 50, 100] as const).map((f) => (
                          <button
                            key={f}
                            className={sellFrac === f ? "rs-preset rs-preset-on" : "rs-preset"}
                            onClick={() => setSellFrac(f)}
                          >
                            {f}%
                          </button>
                        ))}
                      </div>
                      <button className="rs-sign rs-sign-on sell-confirm" onClick={() => console.log(`sell ${sellFrac}%`)}>
                        sell for {fmtUsd2(net)}
                      </button>
                    </>
                  );
                })()
              ) : (
                <div className="mod-row">
                  <span className="mod-quiet">no position in this market</span>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="card mod">
          <div className="mod-row">
            <span className="mod-quiet">staked</span>
            <span className="mod-strong">{fmtUsd(data.a.potUsd + data.b.potUsd)}</span>
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
