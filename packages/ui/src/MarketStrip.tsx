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
 *    Settled/forfeited replace it with the fewest possible words.
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
  /**
   * Called when a stake is signed. Absent = read-only strip. Return false
   * to reject (e.g. prompt login at the point of action) — the success
   * line only shows when the handler accepts.
   */
  onSign?: (side: "a" | "b", amountUsd: number) => boolean | void;
  /** Instrumentation for the preset ladder (tune from real data). */
  onPresetUsed?: (amountUsd: number | "custom") => void;
  /**
   * The whole strip clicks through to the market page — tweet text, bar,
   * clock line, empty space — EXCEPT the two username rows (bet targets)
   * and the betting panel. `onOpen` handles navigation (app: router push;
   * extension: new tab); `marketHref` is the fallback via location.assign.
   */
  marketHref?: string;
  onOpen?: () => void;
  /** Market page variant: render both tweets in full, no clamp (§2). */
  fullText?: boolean;
}

/** Small heart before the count: reads as likes without a label. */
function Heart() {
  return (
    <svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor" aria-hidden>
      <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
    </svg>
  );
}

function Row({
  side,
  who,
  leading,
  selected,
  tappable,
  onPick,
  fullText = false,
}: {
  side: StripSide;
  who: "a" | "b";
  leading: boolean;
  selected: boolean;
  tappable: boolean;
  onPick: (who: "a" | "b") => void;
  fullText?: boolean;
}) {
  const [expanded, setExpanded] = useState(fullText);
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
      {side.avatarUrl ? (
        <img className="rs-avatar" src={side.avatarUrl} alt="" />
      ) : (
        <span className="rs-avatar rs-avatar-fallback">
          {side.handle[0]?.toUpperCase()}
        </span>
      )}
      <div className="rs-row-main">
        <span className="rs-row-handle">@{side.handle}</span>
        <span className={expanded ? "rs-row-text" : "rs-row-text rs-clamp"}>
          {side.text}
        </span>
        {!fullText && side.text.length > 100 && (
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
      <span className="rs-row-likes">
        <Heart />
        {fmtLikes(side.likes)}
      </span>
      {side.tweetUrl && (
        <a
          className="rs-row-x"
          href={side.tweetUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`open @${side.handle}'s post on X`}
          onClick={(e) => e.stopPropagation()}
        >
          ↗
        </a>
      )}
    </div>
  );
}

export function MarketStrip({ data, nowMs, onSign, onPresetUsed, marketHref, onOpen, fullText }: MarketStripProps) {
  const now = nowMs ?? Date.now();
  const [backing, setBacking] = useState<"a" | "b" | null>(null);
  const [amount, setAmount] = useState<number | null>(null);
  const [custom, setCustom] = useState<string | null>(null);
  const [placed, setPlaced] = useState<{ side: "a" | "b"; amountUsd: number } | null>(null);

  const open = data.status === "open" && now < data.settlesAtMs;
  const decided = data.status === "settled" || data.status === "forfeited";
  const tappable = open && Boolean(onSign);
  // Exact tie renders A leading — never said aloud. Settled shades the winner.
  const leading: "a" | "b" =
    decided && data.winner
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
  // Starting a new pick clears the previous success line.
  const pick = (who: "a" | "b") => {
    setBacking(backing === who ? null : who);
    setAmount(null);
    setCustom(null);
    setPlaced(null);
  };

  const sign = () => {
    if (!backing || !amount) return;
    if (onSign?.(backing, amount) === false) return; // rejected: panel stays
    // Panel folds closed; the success line folds open in its place. The
    // reader keeps scrolling (and can tap a row to go again).
    setPlaced({ side: backing, amountUsd: amount });
    setBacking(null);
    setAmount(null);
    setCustom(null);
  };

  // The ONE line of copy. Settled/forfeited replace it with the outcome.
  const rule =
    data.status === "settled" && data.winner
      ? `@${(data.winner === "a" ? data.a : data.b).handle} won`
      : data.status === "forfeited" && data.winner
        ? `@${(data.winner === "a" ? data.a : data.b).handle} wins by forfeit`
        : `most likes in ${timeLeft(data.settlesAtMs, now)} wins`;

  // Bar: each side keeps a visible share; an empty side is a SLIVER, so a
  // one-sided market reads as lopsided rather than full.
  const total = data.a.potUsd + data.b.potUsd;
  const aPct = total === 0 ? 50 : Math.min(98, Math.max(2, (data.a.potUsd / total) * 100));

  const clickable = Boolean(onOpen || marketHref);
  const openMarket = (e: React.MouseEvent) => {
    if (!clickable) return;
    // bet targets and the betting panel never navigate
    if ((e.target as HTMLElement).closest(".rs-row-tap, .rs-fold, button, input, a")) return;
    if (onOpen) onOpen();
    else if (marketHref) window.location.assign(marketHref);
  };

  return (
    <div
      className={clickable ? "rs-strip rs-strip-link" : "rs-strip"}
      data-status={data.status}
      onClick={openMarket}
      // While picking, green belongs to the selection: the leader's tint
      // drops so green never means two things at once.
      data-picking={backing ? "" : undefined}
    >
      {data.hiddenFromThread && (
        // Story beat, not error state: observation wording only — never a
        // claim about who hid it. Surfaced prominently.
        <div className="rs-hidden-beat">
          this reply is no longer visible in the thread · the market is still open
        </div>
      )}

      <Row side={data.a} who="a" leading={leading === "a"} selected={backing === "a"} tappable={tappable} onPick={pick} fullText={fullText} />
      <Row side={data.b} who="b" leading={leading === "b"} selected={backing === "b"} tappable={tappable} onPick={pick} fullText={fullText} />

      {/* The one divider: tweets block above, money block below. */}
      <div className="rs-divider" />
      <div className="rs-money">
        <div className="rs-pot-row">
          <span className="rs-pot-side">
            {fmtUsd(data.a.potUsd)} @{data.a.handle}
          </span>
          <span className="rs-pot-mid">{fmtUsd(total)} staked</span>
          <span className="rs-pot-side">
            {fmtUsd(data.b.potUsd)} @{data.b.handle}
          </span>
        </div>
        <div className="rs-bar">
          <div className="rs-bar-a" style={{ width: `${aPct}%` }} />
          <div className="rs-bar-b" />
        </div>
        {/* One permanent line: the rule at left, the payout quote at right.
            The quote fills an ALWAYS-PRESENT slot, so nothing ever jumps. */}
        <div className="rs-bottom">
          <span className="rs-rule">{rule}</span>
          <span className="rs-quote">
            {quote && backing
              ? formatQuote(quote, (backing === "a" ? data.a : data.b).handle)
              : ""}
          </span>
        </div>
      </div>

      {/* The betting panel FOLDS OUT below everything on a row tap: resting
          cards are just tweets + the money line, so scrolling stays clean.
          Content stays mounted while the fold animates closed. */}
      <div className={backing ? "rs-fold rs-fold-open" : "rs-fold"} aria-hidden={!backing}>
        <div>
        <div className="rs-amount">
          {/* The grid never leaves. Custom is not a separate screen — the
              button itself becomes the field, in place, in the sign row. */}
          <div className="rs-presets">
            {PRESETS.map((p) => (
              <button
                key={p}
                className={amount === p && custom === null ? "rs-preset rs-preset-on" : "rs-preset"}
                onClick={() => {
                  setAmount(p);
                  setCustom(null); // a preset tap exits custom mode
                  onPresetUsed?.(p);
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
                  onPresetUsed?.("custom");
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
                  const n = Number(raw);
                  setAmount(n > 0 ? n : null);
                }}
                onBlur={() => {
                  if (!custom) setCustom(null); // empty field reverts to the button
                }}
              />
            )}
            {/* Always visible; muted until an amount exists; never hidden. */}
            <button
              className={amount ? "rs-sign rs-sign-on" : "rs-sign"}
              disabled={!amount}
              onClick={sign}
            >
              Sign
            </button>
          </div>
        </div>
        </div>
      </div>

      {/* Post-sign: the panel closed; a slim success line folds open. The
          reader keeps scrolling, or taps through to the market page. */}
      <div className={placed ? "rs-fold rs-fold-open" : "rs-fold"} aria-hidden={!placed}>
        <div>
          {placed && (
            // no separate view-market link: the strip itself clicks through
            <div className="rs-placed">
              <span className="rs-placed-msg">
                ✓ ${placed.amountUsd} on @{(placed.side === "a" ? data.a : data.b).handle} placed
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
