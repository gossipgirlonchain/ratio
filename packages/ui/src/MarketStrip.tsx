/**
 * The market strip — the canonical UI. Injected under a tweet by the
 * extension; mirrored verbatim by feed, post page, and market page.
 * Inherits the host's radius/font/greys via CSS custom properties.
 *
 * Layout rules (winny, 2026-08-03 revision):
 *  - Both tweets are SIBLING ROWS in one container, identical treatment.
 *    The OP is a competitor, not context. The only differentiator is which
 *    row is shaded (the leader; bold count too).
 *  - Like counts sit at the right of each row, 13px, attached to their
 *    person. No hero numbers, no ? hints anywhere.
 *  - ONE line of explanatory copy in the whole strip: "most likes in
 *    <time> wins". Settled/voided states replace that line with the
 *    fewest possible words.
 *  - Nothing is big: 12-13px throughout, X body-text scale. The strip is
 *    timeline furniture, not a banner.
 *  - Tap a ROW to back that person. The amount grid exists only after a
 *    pick, swapped into the money region IN PLACE (grid-cell stack — the
 *    strip never changes height inside a live timeline).
 */
import { useMemo, useState } from "react";

import { formatQuote, quotePayout } from "./payout";
import type { MarketStripData, StripSide } from "./types";

const PRESETS = [1, 5, 25, 100, 250, 500] as const;

const fmtLikes = (n: number): string =>
  n >= 1_000_000
    ? `${(n / 1_000_000).toFixed(1)}M`
    : n >= 10_000
      ? `${Math.round(n / 1_000)}K`
      : n >= 1_000
        ? `${(n / 1_000).toFixed(1)}K`
        : String(n);

const fmtUsd = (n: number): string =>
  `$${n >= 1_000 ? n.toLocaleString("en-US", { maximumFractionDigits: 0 }) : n.toFixed(0)}`;

const timeLeft = (settlesAtMs: number, nowMs: number): string => {
  const ms = Math.max(0, settlesAtMs - nowMs);
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};

export interface MarketStripProps {
  data: MarketStripData;
  nowMs?: number;
  /** Called when a stake is signed. Absent = read-only strip. */
  onSign?: (side: "a" | "b", amountUsd: number) => void;
  /** Instrumentation for the preset ladder (tune from real data). */
  onPresetUsed?: (amountUsd: number | "custom") => void;
}

function Row({
  side,
  who,
  leading,
  tappable,
  onPick,
}: {
  side: StripSide;
  who: "a" | "b";
  leading: boolean;
  tappable: boolean;
  onPick: (who: "a" | "b") => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const cls = ["rs-row", leading && "rs-row-lead", tappable && "rs-row-tap"]
    .filter(Boolean)
    .join(" ");
  return (
    <div
      className={cls}
      role={tappable ? "button" : undefined}
      tabIndex={tappable ? 0 : undefined}
      onClick={tappable ? () => onPick(who) : undefined}
      onKeyDown={
        tappable ? (e) => e.key === "Enter" && onPick(who) : undefined
      }
    >
      <div className="rs-row-main">
        <span className="rs-row-handle">@{side.handle}</span>
        <span className={expanded ? "rs-row-text" : "rs-row-text rs-clamp"}>
          {side.text}
        </span>
        {side.text.length > 100 && (
          <span
            className="rs-expand"
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              setExpanded(!expanded);
            }}
          >
            {expanded ? "less" : "more"}
          </span>
        )}
      </div>
      <span className="rs-row-likes">{fmtLikes(side.likes)}</span>
    </div>
  );
}

export function MarketStrip({ data, nowMs, onSign, onPresetUsed }: MarketStripProps) {
  const now = nowMs ?? Date.now();
  const [backing, setBacking] = useState<"a" | "b" | null>(null);
  const [amount, setAmount] = useState<number | null>(null);
  const [custom, setCustom] = useState<string | null>(null);

  const open = data.status === "open" && now < data.settlesAtMs;
  const tappable = open && Boolean(onSign);
  // Exact tie renders A leading — never said aloud. Settled shades the winner.
  const leading: "a" | "b" =
    data.status === "settled" && data.winner
      ? data.winner
      : data.a.likes >= data.b.likes
        ? "a"
        : "b";

  const quote = useMemo(() => {
    if (!backing || !amount) return null;
    return quotePayout({
      stakeUsd: amount,
      potAUsd: data.a.potUsd,
      potBUsd: data.b.potUsd,
      yourSideUsd: (backing === "a" ? data.a : data.b).potUsd,
    });
  }, [backing, amount, data]);

  const pick = (who: "a" | "b") => {
    setBacking(backing === who ? null : who);
    setAmount(null);
    setCustom(null);
  };

  // The ONE line of copy. Settled/voided replace it with the outcome.
  const rule =
    data.status === "settled" && data.winner
      ? `@${(data.winner === "a" ? data.a : data.b).handle} won`
      : data.status === "voided"
        ? "voided · stakes refunded"
        : `most likes in ${timeLeft(data.settlesAtMs, now)} wins`;

  return (
    <div className="rs-strip" data-status={data.status}>
      {data.hiddenFromThread && (
        // Story beat, not error state: observation wording only — never a
        // claim about who hid it. Surfaced prominently.
        <div className="rs-hidden-beat">
          this reply is no longer visible in the thread · the market is still open
        </div>
      )}

      {/* The WHOLE body swaps with the amount view in one grid cell. The
          body is the taller view, so resting strips carry no reserved dead
          space and picking a row still cannot change the height. */}
      <div className="rs-swap">
        <div className={backing ? "rs-view rs-view-off" : "rs-view"}>
          <Row side={data.a} who="a" leading={leading === "a"} tappable={tappable} onPick={pick} />
          <Row side={data.b} who="b" leading={leading === "b"} tappable={tappable} onPick={pick} />

          <div className="rs-rule">{rule}</div>
          <div className="rs-divider" />

          <div className="rs-money">
            <div className="rs-bar">
              <div
                className="rs-bar-a"
                style={{
                  width: `${
                    data.a.potUsd + data.b.potUsd === 0
                      ? 50
                      : (data.a.potUsd / (data.a.potUsd + data.b.potUsd)) * 100
                  }%`,
                }}
              />
            </div>
            <div className="rs-pot-row">
              <span>{fmtUsd(data.a.potUsd)}</span>
              <span className="rs-pot-mid">{fmtUsd(data.a.potUsd + data.b.potUsd)} pot</span>
              <span>{fmtUsd(data.b.potUsd)}</span>
            </div>
          </div>
        </div>

        <div className={backing ? "rs-view rs-view-amount" : "rs-view rs-view-amount rs-view-off"}>
          <div className="rs-amount">
            <div className="rs-quote-row">
              {/* Cancel affordance: tap the backing line to unpick. */}
              <button className="rs-backing" onClick={() => backing && pick(backing)}>
                backing @{backing ? (backing === "a" ? data.a : data.b).handle : ""} ✕
              </button>
              {quote && <span className="rs-quote">{formatQuote(quote)}</span>}
            </div>
            {custom === null ? (
              <div className="rs-presets">
                {PRESETS.map((p) => (
                  <button
                    key={p}
                    className={amount === p ? "rs-preset rs-preset-on" : "rs-preset"}
                    onClick={() => {
                      setAmount(p);
                      onPresetUsed?.(p);
                    }}
                  >
                    ${p}
                  </button>
                ))}
              </div>
            ) : (
              <div className="rs-custom">
                <button
                  className="rs-back-arrow"
                  aria-label="back to presets"
                  onClick={() => {
                    setCustom(null);
                    setAmount(null);
                  }}
                >
                  ←
                </button>
                <input
                  className="rs-custom-input"
                  inputMode="decimal"
                  autoFocus
                  placeholder="$0"
                  value={custom}
                  onChange={(e) => {
                    const raw = e.target.value.replace(/[^0-9.]/g, "");
                    setCustom(raw);
                    const n = Number(raw);
                    setAmount(n > 0 ? n : null);
                  }}
                />
              </div>
            )}
            <div className="rs-sign-row">
              {custom === null && (
                <button
                  className="rs-custom-btn"
                  onClick={() => {
                    setCustom("");
                    setAmount(null);
                    onPresetUsed?.("custom");
                  }}
                >
                  Custom
                </button>
              )}
              {/* Always visible; muted until an amount exists; never hidden. */}
              <button
                className={amount ? "rs-sign rs-sign-on" : "rs-sign"}
                disabled={!amount}
                onClick={() => backing && amount && onSign?.(backing, amount)}
              >
                Sign
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
