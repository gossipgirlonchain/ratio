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
const VOL_H = 64;
const PAD = { l: 8, r: 34, gap: 18, top: 10, bottom: 22 };
const H_TOTAL = LINE_H + PAD.gap + VOL_H + PAD.top + PAD.bottom;

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

  const { pathA, pathB, x, yLike, likeMax, volMax } = useMemo(() => {
    const likeMax = Math.max(...series.likesA, ...series.likesB) * 1.08;
    // stacked bars: the scale is the stacked TOTAL, not the larger side
    const volMax = Math.max(...series.volA.map((v, i) => v + series.volB[i]!), 1);
    const x = (i: number) => PAD.l + ((W - PAD.l - PAD.r) * i) / (n - 1);
    const yLike = (v: number) => PAD.top + LINE_H - (LINE_H * v) / likeMax;
    const path = (vals: number[]) =>
      vals.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${yLike(v).toFixed(1)}`).join("");
    return { pathA: path(series.likesA), pathB: path(series.likesB), x, yLike, likeMax, volMax };
  }, [series, n]);

  const volTop = PAD.top + LINE_H + PAD.gap;
  const yVol = (v: number) => (VOL_H * v) / volMax;
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
        <span className="chart-legend-vol"><i className="chart-swatch chart-swatch-bar" /> money in</span>
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

        {/* money: ONE stacked bar per interval — a single series about
            money, not two competing charts. Same entity hues, 1px gap
            between segments. */}
        {series.ts.map((_, i) => {
          const a = series.volA[i]!;
          const b = series.volB[i]!;
          if (a + b === 0) return null;
          const hA = yVol(a);
          const hB = yVol(b);
          return (
            <g key={i}>
              {a > 0 && (
                <rect
                  x={x(i) - barW / 2}
                  y={volTop + VOL_H - hA}
                  width={barW}
                  height={hA}
                  rx="1"
                  fill={A}
                />
              )}
              {b > 0 && (
                <rect
                  x={x(i) - barW / 2}
                  y={volTop + VOL_H - hA - (a > 0 ? 1 : 0) - hB}
                  width={barW}
                  height={hB}
                  rx="1"
                  fill={B}
                />
              )}
            </g>
          );
        })}
        <line x1={PAD.l} x2={W - PAD.r} y1={volTop + VOL_H} y2={volTop + VOL_H} className="chart-axis" />

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
            <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={volTop + VOL_H} className="chart-crosshair" />
            <circle cx={x(hover)} cy={yLike(series.likesA[hover]!)} r="3.5" fill={A} stroke="#fff" strokeWidth="1.5" />
            <circle cx={x(hover)} cy={yLike(series.likesB[hover]!)} r="3.5" fill={B} stroke="#fff" strokeWidth="1.5" />
            <g
              transform={`translate(${
                x(hover) + 130 > W - PAD.r ? x(hover) - 130 : x(hover) + 12
              }, ${PAD.top + 8})`}
            >
              <rect width="118" height="52" rx="8" className="chart-tip" />
              <text x="9" y="15" className="chart-tip-time">{fmtClock(series.ts[hover]!)}</text>
              <circle cx="13" cy="26" r="3" fill={A} />
              <text x="21" y="29" className="chart-tip-text">{fmtLikes(series.likesA[hover]!)}</text>
              <circle cx="63" cy="26" r="3" fill={B} />
              <text x="71" y="29" className="chart-tip-text">{fmtLikes(series.likesB[hover]!)}</text>
              <text x="9" y="44" className="chart-tip-text">
                ${Math.round(series.volA[hover]! + series.volB[hover]!)} staked
              </text>
            </g>
          </g>
        )}
      </svg>
    </div>
  );
}
