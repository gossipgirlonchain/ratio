/**
 * The market strip — the canonical UI. Injected under a tweet by the
 * extension; mirrored verbatim by feed, post page, and market page.
 * Inherits the host's radius/font/greys via CSS custom properties.
 *
 * Layout rules (winny, final 2026-08-03 revision):
 *  - ONE container, and nothing above the amount block ever moves or
 *    disappears. Both tweets are sibling rows with identical treatment;
 *    the leader is shaded with a bold count; counts 13px on the right.
 *  - Height changes the USER initiates are fine (that is how every expand
 *    on X works). The old "never change height" rule only covers
 *    unprompted movement. Tapping a row expands the amount grid BELOW the
 *    money line; deselecting collapses it.
 *  - The rows are the navigation: tap a row to back that person (outlined),
 *    tap the other row to switch, tap the selected row again to collapse.
 *    No back button, no cancel affordance, no "backing @x" line — the
 *    selected row already says all of that.
 *  - ONE line of explanatory copy: "most likes in <time> wins".
 *    Settled/voided replace it with the fewest possible words.
 *  - No status vocabulary anywhere. The clock says whether it is open.
 *  - Money: never the word "pot". A one-sided market must LOOK lopsided —
 *    the empty side renders as a sliver, never as a full/solid bar.
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
  selected,
  tappable,
  onPick,
}: {
  side: StripSide;
  who: "a" | "b";
  leading: boolean;
  selected: boolean;
  tappable: boolean;
  onPick: (who: "a" | "b") => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const cls = [
    "rs-row",
    leading && "rs-row-lead",
    selected && "rs-row-on",
    tappable && "rs-row-tap",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div
      className={cls}
      role={tappable ? "button" : undefined}
      tabIndex={tappable ? 0 : undefined}
      aria-pressed={tappable ? selected : undefined}
      onClick={tappable ? () => onPick(who) : undefined}
      onKeyDown={tappable ? (e) => e.key === "Enter" && onPick(who) : undefined}
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

  // Rows ARE the navigation: same row toggles, other row switches.
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

  // Bar: each side keeps a visible share; an empty side is a SLIVER, so a
  // one-sided market reads as lopsided rather than full.
  const total = data.a.potUsd + data.b.potUsd;
  const aPct = total === 0 ? 50 : Math.min(98, Math.max(2, (data.a.potUsd / total) * 100));

  return (
    <div className="rs-strip" data-status={data.status}>
      {data.hiddenFromThread && (
        // Story beat, not error state: observation wording only — never a
        // claim about who hid it. Surfaced prominently.
        <div className="rs-hidden-beat">
          this reply is no longer visible in the thread · the market is still open
        </div>
      )}

      <Row side={data.a} who="a" leading={leading === "a"} selected={backing === "a"} tappable={tappable} onPick={pick} />
      <div className="rs-hairline" />
      <Row side={data.b} who="b" leading={leading === "b"} selected={backing === "b"} tappable={tappable} onPick={pick} />
      <div className="rs-hairline" />

      <div className="rs-rule">{rule}</div>
      <div className="rs-money">
        <div className="rs-bar">
          <div className="rs-bar-a" style={{ width: `${aPct}%` }} />
          <div className="rs-bar-b" />
        </div>
        <div className="rs-pot-row">
          <span>{fmtUsd(data.a.potUsd)}</span>
          <span className="rs-pot-mid">{fmtUsd(total)} staked</span>
          <span>{fmtUsd(data.b.potUsd)}</span>
        </div>
      </div>

      {/* The amount block appears BELOW everything, user-initiated. Nothing
          above it moves; deselecting the row collapses it. */}
      {backing && (
        <div className="rs-amount">
          <div className="rs-divider" />
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
          {quote && <div className="rs-quote">{formatQuote(quote)}</div>}
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
      )}
    </div>
  );
}
