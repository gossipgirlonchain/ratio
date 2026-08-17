/**
 * The score card as a REAL generated image (spec: not a DOM screenshot —
 * it has to survive being saved and reposted). 1200x675, reads at
 * thumbnail size: one big number, badge top right, four stats, timestamp.
 */

import { ImageResponse } from "next/og";
import { compact, duration, fmt } from "../../../../../lib/format";
import { mockX } from "../../../../../lib/mockX";
import { computeScore, percentileFor } from "../../../../../lib/score";
import { normalizeHandle } from "../../../../../lib/types";

export const dynamic = "force-dynamic";

// dark-theme tokens, hardcoded: og images don't do CSS variables
const C = {
  bg: "#131416",
  ink: "#EDEEF0",
  muted: "#C6CACE",
  edge: "#4A5056",
  accent: "#CEF17B",
  onAccent: "#131608",
  mint: "#8FB0AB",
};

export async function GET(
  req: Request,
  { params }: { params: { handle: string } },
) {
  const handle = normalizeHandle(decodeURIComponent(params.handle));
  const res = await mockX.lookup(handle);
  if (!res.ok) return new Response("not found", { status: 404 });
  const s = computeScore(res.replies);
  const pct = percentileFor(s.score);

  const stat = (label: string, value: string) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontSize: 20, fontWeight: 700, color: C.muted, letterSpacing: 2 }}>
        {label.toUpperCase()}
      </span>
      <span style={{ fontSize: 34, fontWeight: 900, color: C.ink }}>{value}</span>
    </div>
  );

  const img = new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: C.bg,
          padding: 56,
          fontFamily: "sans-serif",
        }}
      >
        {/* head row */}
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={res.user.avatarUrl}
            width={88}
            height={88}
            style={{ borderRadius: 999, border: `3px solid ${C.edge}` }}
          />
          <div style={{ display: "flex", flexDirection: "column" }}>
            <span style={{ fontSize: 36, fontWeight: 900, color: C.ink }}>{res.user.name}</span>
            <span style={{ fontSize: 26, color: C.muted }}>@{res.user.handle}</span>
          </div>
          <div
            style={{
              marginLeft: "auto",
              background: C.accent,
              color: C.onAccent,
              fontSize: 30,
              fontWeight: 900,
              padding: "10px 22px",
              borderRadius: 12,
              transform: "rotate(1.5deg)",
              letterSpacing: 1,
            }}
          >
            {s.tier}
          </div>
        </div>

        {/* the number */}
        <span style={{ fontSize: 26, fontWeight: 700, color: C.muted, letterSpacing: 4, marginTop: 40 }}>
          REPLY SCORE
        </span>
        <span style={{ fontSize: 150, fontWeight: 900, color: C.ink, lineHeight: 1, marginTop: 4 }}>
          {fmt(s.score)}
        </span>
        <span style={{ fontSize: 30, fontWeight: 800, color: C.accent, marginTop: 8 }}>
          {s.score === 0 ? "flawless silence" : pct.label}
        </span>

        {/* stats — MOST REPLIED TO is the funniest line, give it room */}
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 52 }}>
          {stat("replies 7d", fmt(s.volume))}
          {stat("avg reply time", s.volume ? duration(s.medianReplyS) : "n/a")}
          {stat(
            "most replied to",
            s.mostRepliedTo ? `@${s.mostRepliedTo.handle} x${s.mostRepliedTo.count}` : "nobody",
          )}
          {stat(
            "biggest room",
            s.biggestRoom ? `@${s.biggestRoom.handle} ${compact(s.biggestRoom.replyCount)}` : "none",
          )}
        </div>

        {/* foot: wordmark + snapshot date (a 7d window is not permanent) */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            marginTop: "auto",
            paddingTop: 24,
            borderTop: `2px solid ${C.edge}`,
          }}
        >
          <span
            style={{
              background: C.accent,
              color: C.onAccent,
              fontSize: 30,
              fontWeight: 900,
              padding: "4px 16px 8px",
              borderRadius: 10,
              transform: "rotate(-1.2deg)",
            }}
          >
            ratio
          </span>
          <span style={{ marginLeft: "auto", fontSize: 20, color: C.mint }}>
            last 7 days · {new Date().toISOString().slice(0, 10)}
          </span>
        </div>
      </div>
    ),
    { width: 1200, height: 675 },
  );

  // ?dl=1 → save-to-camera-roll path
  if (new URL(req.url).searchParams.get("dl") === "1") {
    const headers = new Headers(img.headers);
    headers.set("content-disposition", `attachment; filename="reply-score-${handle}.png"`);
    return new Response(img.body, { headers });
  }
  return img;
}
