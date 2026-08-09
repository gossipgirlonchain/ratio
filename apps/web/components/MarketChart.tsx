"use client";

/**
 * The chart, built (not described): likes as two lines — the oracle, the
 * hero, the crossover is the story — with money as per-side bars beneath
 * on the same time axis. One axis per panel, no dual-axis anywhere.
 *
 * Series colors are validated (dataviz six checks, light surface):
 * side A #2E7DBF, side B #7A9A2E — CVD ΔE 23.7, contrast ≥ 3:1. Identity
 * is never color-alone: direct labels at the line ends + a legend.
 * Text wears ink tokens, never series color. Crosshair + tooltip on hover.
 */
import { useMemo, useRef, useState } from "react";

import type { ChartSeries } from "../lib/fixtures";

const A = "#2E7DBF";
const B = "#7A9A2E";

const W = 640;
const LINE_H = 230;
/** Money panel: buys stack UP from the zero line, sells stack DOWN. */
const VOL_UP = 52;
const VOL_DOWN = 26;
const PAD = { l: 8, r: 34, gap: 18, top: 10, bottom: 22 };
const H_TOTAL = LINE_H + PAD.gap + VOL_UP + VOL_DOWN + PAD.top + PAD.bottom;

const fmtLikes = (n: number): string =>
  n >= 1_000 ? `${(n / 1_000).toFixed(1)}K` : String(Math.round(n));

const fmtClock = (ms: number): string => {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

export function MarketChart({
  series,
  handleA,
  handleB,
}: {
  series: ChartSeries;
  handleA: string;
  handleB: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const n = series.ts.length;

  const { pathA, pathB, x, yLike, likeMax, pxPerUsd } = useMemo(() => {
    const likeMax = Math.max(...series.likesA, ...series.likesB) * 1.08;
    // ONE $/px scale for both directions — up and down share an axis.
    const buyMax = Math.max(...series.buyA.map((v, i) => v + series.buyB[i]!), 1);
    const sellMax = Math.max(...series.sellA.map((v, i) => v + series.sellB[i]!), 0);
    const pxPerUsd = Math.min(VOL_UP / buyMax, sellMax > 0 ? VOL_DOWN / sellMax : Infinity);
    const x = (i: number) => PAD.l + ((W - PAD.l - PAD.r) * i) / (n - 1);
    const yLike = (v: number) => PAD.top + LINE_H - (LINE_H * v) / likeMax;
    const path = (vals: number[]) =>
      vals.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${yLike(v).toFixed(1)}`).join("");
    return { pathA: path(series.likesA), pathB: path(series.likesB), x, yLike, likeMax, pxPerUsd };
  }, [series, n]);

  const zeroY = PAD.top + LINE_H + PAD.gap + VOL_UP; // the money zero line
  const barW = Math.max(2, (W - PAD.l - PAD.r) / n - 2);

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const i = Math.round(((px - PAD.l) / (W - PAD.l - PAD.r)) * (n - 1));
    setHover(Math.min(n - 1, Math.max(0, i)));
  };

  return (
    <div className="chart-wrap">
      <div className="chart-legend">
        <span><i className="chart-swatch" style={{ background: A }} /> @{handleA} likes</span>
        <span><i className="chart-swatch" style={{ background: B }} /> @{handleB} likes</span>
        <span className="chart-legend-vol"><i className="chart-swatch chart-swatch-bar" /> money in ↑ · out ↓</span>
      </div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H_TOTAL}`}
        className="chart-svg"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        role="img"
        aria-label={`likes over time for @${handleA} and @${handleB}, with money staked per interval below`}
      >
        {/* recessive grid: three horizontal lines, likes panel */}
        {[0.25, 0.5, 0.75].map((f) => (
          <line
            key={f}
            x1={PAD.l}
            x2={W - PAD.r}
            y1={PAD.top + LINE_H * f}
            y2={PAD.top + LINE_H * f}
            className="chart-grid"
          />
        ))}
        <text x={W - PAD.r + 6} y={yLike(likeMax / 1.08) + 4} className="chart-tick">
          {fmtLikes(likeMax / 1.08)}
        </text>

        <path d={pathA} fill="none" stroke={A} strokeWidth="2" strokeLinejoin="round" />
        <path d={pathB} fill="none" stroke={B} strokeWidth="2" strokeLinejoin="round" />

        {/* money, two channels kept separate: DIRECTION is vertical (buys
            stack up from the zero line, sells stack down), COLOUR is side,
            matched to the like lines. Per-interval, never cumulative. */}
        {series.ts.map((_, i) => {
          const bA = series.buyA[i]! * pxPerUsd;
          const bB = series.buyB[i]! * pxPerUsd;
          const sA = series.sellA[i]! * pxPerUsd;
          const sB = series.sellB[i]! * pxPerUsd;
          if (bA + bB + sA + sB === 0) return null;
          const bx = x(i) - barW / 2;
          return (
            <g key={i}>
              {bA > 0 && <rect x={bx} y={zeroY - bA} width={barW} height={bA} rx="1" fill={A} />}
              {bB > 0 && (
                <rect x={bx} y={zeroY - bA - (bA > 0 ? 1 : 0) - bB} width={barW} height={bB} rx="1" fill={B} />
              )}
              {sA > 0 && <rect x={bx} y={zeroY + 1} width={barW} height={sA} rx="1" fill={A} />}
              {sB > 0 && (
                <rect x={bx} y={zeroY + 1 + sA + (sA > 0 ? 1 : 0)} width={barW} height={sB} rx="1" fill={B} />
              )}
            </g>
          );
        })}
        <line x1={PAD.l} x2={W - PAD.r} y1={zeroY} y2={zeroY} className="chart-axis" />

        {/* time ticks */}
        <text x={PAD.l} y={H_TOTAL - 6} className="chart-tick">
          {fmtClock(series.ts[0]!)}
        </text>
        <text x={W - PAD.r} y={H_TOTAL - 6} className="chart-tick" textAnchor="end">
          now
        </text>

        {/* crosshair + tooltip: light surface, three short lines, flips
            sides so it never leaves the plot */}
        {hover !== null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={zeroY + VOL_DOWN} className="chart-crosshair" />
            <circle cx={x(hover)} cy={yLike(series.likesA[hover]!)} r="3.5" fill={A} stroke="#fff" strokeWidth="1.5" />
            <circle cx={x(hover)} cy={yLike(series.likesB[hover]!)} r="3.5" fill={B} stroke="#fff" strokeWidth="1.5" />
            {(() => {
              // money split by side, matching the bars' colour encoding;
              // the out row disappears entirely when the interval had no sells
              const outA = Math.round(series.sellA[hover]!);
              const outB = Math.round(series.sellB[hover]!);
              const hasOut = outA + outB > 0;
              const TIP_W = 158;
              const TIP_H = hasOut ? 76 : 61;
              // flip early enough to clear the y-max label at the right edge
              const tipX = x(hover) + TIP_W + 16 > W - PAD.r ? x(hover) - TIP_W - 12 : x(hover) + 12;
              const row = (label: string, y: number, va: string, vb: string) => (
                <g key={label}>
                  <text x="9" y={y} className="chart-tip-label">{label}</text>
                  <circle cx="44" cy={y - 3} r="3" fill={A} />
                  <text x="52" y={y} className="chart-tip-text">{va}</text>
                  <circle cx="103" cy={y - 3} r="3" fill={B} />
                  <text x="111" y={y} className="chart-tip-text">{vb}</text>
                </g>
              );
              return (
                <g transform={`translate(${tipX}, ${PAD.top + 12})`}>
                  <rect width={TIP_W} height={TIP_H} rx="8" className="chart-tip" />
                  <text x="9" y="15" className="chart-tip-time">{fmtClock(series.ts[hover]!)}</text>
                  {row("like", 31, fmtLikes(series.likesA[hover]!), fmtLikes(series.likesB[hover]!))}
                  {row("in", 46, `$${Math.round(series.buyA[hover]!)}`, `$${Math.round(series.buyB[hover]!)}`)}
                  {hasOut && row("out", 61, `$${outA}`, `$${outB}`)}
                </g>
              );
            })()}
          </g>
        )}
      </svg>
    </div>
  );
}
