/**
 * The market's share card, 1200x630, rendered at the edge.
 *
 * OPEN markets: both avatars, colour-coded rings (chart colours), the
 * handles, a versus mark, the ratio wordmark. NOTHING time-sensitive —
 * X scrapes once and caches forever, so likes, pots, and countdowns
 * would freeze wrong. SETTLED markets get the result treatment instead
 * (safe: generated after the numbers stop moving): final counts and the
 * winner ringed in their colour.
 *
 * Avatars are fetched here with a hard timeout; a failed fetch falls
 * back to an initial-letter disc, never a broken image.
 */
import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "ratio market";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const A_COLOR = "#4E97D6";
const B_COLOR = "#7FA32E";
const BG = "#131416";
const INK = "#EDEEF0";
const MUTED = "#C6CACE";
const LIME = "#CEF17B";

interface MarketRow {
  author_a_handle: string;
  author_b_handle: string;
  status: string;
  winner: "a" | "b" | null;
  likes_a_final: number | null;
  likes_b_final: number | null;
}

async function fetchMarket(id: string): Promise<MarketRow | null> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  try {
    const res = await fetch(
      `${url}/rest/v1/markets?id=eq.${encodeURIComponent(id)}&select=author_a_handle,author_b_handle,status,winner,likes_a_final,likes_b_final`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } },
    );
    const rows = (await res.json()) as MarketRow[];
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

/** Avatar as a data URI, or null on any failure (timeout included). */
async function fetchAvatar(handle: string): Promise<string | null> {
  try {
    const res = await fetch(`https://unavatar.io/x/${handle}?fallback=false`, {
      signal: AbortSignal.timeout(3_000),
    });
    if (!res.ok) return null;
    const type = res.headers.get("content-type") ?? "image/png";
    const buf = await res.arrayBuffer();
    if (buf.byteLength === 0 || buf.byteLength > 4_000_000) return null;
    let bin = "";
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.length; i += 8192) {
      bin += String.fromCharCode(...bytes.subarray(i, i + 8192));
    }
    return `data:${type};base64,${btoa(bin)}`;
  } catch {
    return null;
  }
}

const fmtLikes = (n: number): string =>
  n >= 1_000 ? `${(n / 1_000).toFixed(1)}K` : String(n);

function Avatar({
  src,
  handle,
  color,
  dim,
}: {
  src: string | null;
  handle: string;
  color: string;
  dim: boolean;
}) {
  const ring = {
    width: 240,
    height: 240,
    borderRadius: 999,
    border: `10px solid ${color}`,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    backgroundColor: "#23262A",
    opacity: dim ? 0.45 : 1,
  } as const;
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} width={240} height={240} style={{ ...ring, objectFit: "cover" }} alt="" />
  ) : (
    <div style={ring}>
      <span style={{ fontSize: 110, fontWeight: 800, color: INK }}>
        {handle[0]?.toUpperCase() ?? "?"}
      </span>
    </div>
  );
}

export default async function OgImage({ params }: { params: { id: string } }) {
  const m = await fetchMarket(params.id);
  const handleA = m?.author_a_handle ?? "ratio";
  const handleB = m?.author_b_handle ?? "ratio";
  const settled = m?.status === "settled" || m?.status === "forfeited";
  const winner = settled ? m?.winner : null;
  const [avatarA, avatarB] = await Promise.all([
    fetchAvatar(handleA),
    fetchAvatar(handleB),
  ]);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: BG,
          gap: 34,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 70 }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 22 }}>
            <Avatar src={avatarA} handle={handleA} color={A_COLOR} dim={winner === "b"} />
            <span style={{ fontSize: 44, fontWeight: 700, color: winner === "b" ? MUTED : INK }}>
              @{handleA}
            </span>
            {settled && (
              <span style={{ fontSize: 36, fontWeight: 800, color: A_COLOR }}>
                {fmtLikes(m?.likes_a_final ?? 0)} likes
              </span>
            )}
          </div>
          <span style={{ fontSize: 64, fontWeight: 800, color: LIME, marginBottom: settled ? 90 : 40 }}>
            vs
          </span>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 22 }}>
            <Avatar src={avatarB} handle={handleB} color={B_COLOR} dim={winner === "a"} />
            <span style={{ fontSize: 44, fontWeight: 700, color: winner === "a" ? MUTED : INK }}>
              @{handleB}
            </span>
            {settled && (
              <span style={{ fontSize: 36, fontWeight: 800, color: B_COLOR }}>
                {fmtLikes(m?.likes_b_final ?? 0)} likes
              </span>
            )}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <span
            style={{
              backgroundColor: LIME,
              color: "#131608",
              fontSize: 34,
              fontWeight: 800,
              padding: "6px 26px",
              borderRadius: 999,
            }}
          >
            ratio
          </span>
          {settled && (
            <span style={{ fontSize: 34, fontWeight: 800, color: MUTED }}>
              @{winner === "a" ? handleA : handleB} won
            </span>
          )}
        </div>
      </div>
    ),
    size,
  );
}
