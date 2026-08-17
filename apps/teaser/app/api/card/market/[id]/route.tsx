/**
 * The market card: what the link unfurls to, from BOTH the bot's reply
 * and the user's QT — so it stays neutral and factual (no callout
 * energy). Served live with a short cache so like counts move.
 */

import { ImageResponse } from "next/og";
import { fmt, remaining } from "../../../../../lib/format";
import { getMarket, liveLikes } from "../../../../../lib/markets";

export const dynamic = "force-dynamic";

const C = {
  bg: "#131416",
  ink: "#EDEEF0",
  muted: "#C6CACE",
  edge: "#4A5056",
  accent: "#CEF17B",
  onAccent: "#131608",
  mint: "#8FB0AB",
};

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const m = getMarket(params.id);
  if (!m) return new Response("not found", { status: 404 });
  const likes = liveLikes(m);
  const lead = likes.challenger === likes.mainchar ? null : likes.challenger > likes.mainchar;

  const side = (
    avatar: string,
    handle: string,
    count: number,
    leading: boolean,
  ) => (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14, flex: 1 }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={avatar}
        width={140}
        height={140}
        style={{ borderRadius: 999, border: `4px solid ${leading ? C.accent : C.edge}` }}
      />
      <span style={{ fontSize: 34, fontWeight: 900, color: C.ink }}>@{handle}</span>
      <span
        style={{
          fontSize: 58,
          fontWeight: 900,
          color: leading ? C.onAccent : C.ink,
          background: leading ? C.accent : "transparent",
          padding: "0 18px 6px",
          borderRadius: 14,
        }}
      >
        {fmt(count)}
      </span>
    </div>
  );

  return new ImageResponse(
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
        <div style={{ display: "flex", alignItems: "center", flex: 1 }}>
          {side(m.challenger.avatarUrl, m.challenger.handle, likes.challenger, lead === true)}
          <span style={{ fontSize: 40, fontWeight: 900, color: C.muted, padding: "0 24px" }}>vs</span>
          {side(m.mainchar.avatarUrl, m.mainchar.handle, likes.mainchar, lead === false)}
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            paddingTop: 28,
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
          <span style={{ marginLeft: 24, fontSize: 26, color: C.muted }}>
            most likes in 24h wins
          </span>
          <span style={{ marginLeft: "auto", fontSize: 30, fontWeight: 900, color: C.accent }}>
            {remaining(m.settlesAtMs - Date.now())} left
          </span>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 675,
      // short cache: the card must move as likes move
      headers: { "cache-control": "public, max-age=60" },
    },
  );
}
