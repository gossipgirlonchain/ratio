/**
 * The market strip — the canonical UI (spec §1). Injected under a tweet by
 * the extension; mirrored verbatim by feed, post page, and market page.
 * Inherits the host's radius/font/greys via CSS custom properties and adds
 * only a thin border and the two-sided bar.
 *
 * Rules enforced here, not in copy reviews:
 *  - Likes are the hero; money is demoted below a divider. They never share
 *    an axis, a label, or a visual treatment (§3).
 *  - No status vocabulary. No "side A/B", "ahead", "dead even", "bet" (§4).
 *    Type size says who leads; settled/voided get the fewest words possible.
 *  - The amount step swaps IN PLACE — the strip never grows taller inside a
 *    live timeline (§5/§6).
 */
import { useMemo, useState } from "react";

import { formatQuote, quotePayout } from "./payout";
import type { MarketStripData } from "./types";

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
  return h > 0 ? `${h}h ${m}m left` : `${m}m left`;
};

function Hint({ text }: { text: string }) {
  // The explanation lives in the tooltip only, never as visible copy (§3).
  return (
    <span className="rs-hint" tabIndex={0} data-tip={text} aria-label={text}>
      ?
    </span>
  );
}

export interface MarketStripProps {
  data: MarketStripData;
  nowMs?: number;
  /** Called when a stake is signed. Absent = read-only strip. */
  onSign?: (side: "a" | "b", amountUsd: number) => void;
  /** Instrumentation for the preset ladder (§6: tune from real data). */
  onPresetUsed?: (amountUsd: number | "custom") => void;
}

export function MarketStrip({ data, nowMs, onSign, onPresetUsed }: MarketStripProps) {
  const now = nowMs ?? Date.now();
  const [backing, setBacking] = useState<"a" | "b" | null>(null);
  const [amount, setAmount] = useState<number | null>(null);
  const [custom, setCustom] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const open = data.status === "open" && now < data.settlesAtMs;
  const leadingIsA = data.a.likes >= data.b.likes; // exact tie renders A leading — never said aloud

  const quote = useMemo(() => {
    if (!backing || !amount) return null;
    return quotePayout({
      stakeUsd: amount,
      potAUsd: data.a.potUsd,
      potBUsd: data.b.potUsd,
      yourSideUsd: (backing === "a" ? data.a : data.b).potUsd,
    });
  }, [backing, amount, data]);

  const pick = (side: "a" | "b") => {
    if (!open || !onSign) return;
    setBacking(backing === side ? null : side);
    setAmount(null);
    setCustom(null);
  };

  return (
    <div className="rs-strip" data-status={data.status}>
      {data.hiddenFromThread && (
        // Story beat, not error state (§10): observation wording only —
        // never a claim about who hid it. Surfaced prominently.
        <div className="rs-hidden-beat">
          this reply is no longer visible in the thread · the market is still open
        </div>
      )}

      <div className="rs-reply">
        <span className="rs-reply-handle">@{data.b.handle}</span>
        <span className={expanded ? "rs-reply-text" : "rs-reply-text rs-clamp"}>
          {data.replyText}
        </span>
        {data.replyText.length > 90 && (
          <button className="rs-expand" onClick={() => setExpanded(!expanded)}>
            {expanded ? "less" : "more"}
          </button>
        )}
      </div>

      {/* Likes: the hero. Two people, two numbers. Size says who leads. */}
      <div className="rs-likes">
        <div className={leadingIsA ? "rs-like rs-leading" : "rs-like rs-trailing"}>
          <span className="rs-like-count">{fmtLikes(data.a.likes)}</span>
        </div>
        <Hint text="Likes decide it. Whichever tweet has more likes when the clock runs out wins." />
        <div className={leadingIsA ? "rs-like rs-trailing" : "rs-like rs-leading"}>
          <span className="rs-like-count">{fmtLikes(data.b.likes)}</span>
        </div>
      </div>

      {/*
       * In-place swap (§5): both views occupy the SAME grid cell; the
       * inactive one is visibility:hidden. Height = max(both) from first
       * paint, so tapping a username can never grow the strip mid-timeline.
       */}
      <div className="rs-swap">
        <div className={backing ? "rs-view rs-view-off" : "rs-view"}>
          {open && onSign && (
            <div className="rs-buttons">
              <button className="rs-back" onClick={() => pick("a")}>
                @{data.a.handle}
              </button>
              <button className="rs-back" onClick={() => pick("b")}>
                @{data.b.handle}
              </button>
            </div>
          )}
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
              <span className="rs-pot-mid">
                {fmtUsd(data.a.potUsd + data.b.potUsd)} pot
                <Hint text="Each market on this post has its own separate pot." />
              </span>
              <span>{fmtUsd(data.b.potUsd)}</span>
            </div>
            <div className="rs-meta">
              {data.status === "open" && timeLeft(data.settlesAtMs, now)}
              {data.status === "settled" && data.winner && (
                <span>@{(data.winner === "a" ? data.a : data.b).handle} won</span>
              )}
              {data.status === "voided" && <span>voided · stakes refunded</span>}
            </div>
          </div>
        </div>

        <div className={backing ? "rs-view" : "rs-view rs-view-off"}>
          <div className="rs-divider" />
          <div className="rs-amount">
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
            <div className="rs-quote-row">
              {/* Cancel affordance: tap the backing line to return to the two names. */}
              <button className="rs-backing" onClick={() => pick(backing ?? "a")}>
                backing @{backing ? (backing === "a" ? data.a : data.b).handle : ""} ✕
              </button>
              {quote && <span className="rs-quote">{formatQuote(quote)}</span>}
            </div>
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
              {/* Always visible; muted until an amount exists; never hidden (§6). */}
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
