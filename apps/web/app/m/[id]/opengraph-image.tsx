/**
 * The market's share card, 1200x630, rendered at the edge — winny's
 * glow-card design: dark rounded panel with a lime glow border, ratio
 * wordmark top centre, two glowing lime-ringed avatars, a vs slash
 * between them, pixel-dash corner decorations.
 *
 * If apps/web/public/og-bg.png exists it becomes the exact background
 * and this layout composites avatars + handles over it.
 *
 * OPEN markets: no numbers of any kind — X scrapes once and caches
 * forever. SETTLED markets add final like counts and dim the loser
 * (safe: those numbers stop moving).
 *
 * Avatars fetch with a hard timeout; failure renders an empty glowing
 * ring (matching the design's own placeholder), never a broken image.
 */
import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "ratio market";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const LIME = "#CEF17B";
const LIME_GLOW = "rgba(206, 241, 123, 0.55)";
const BG = "#0C0D0E";
const CARD = "#141517";
const INK = "#F2F3F4";
const MUTED = "#9BA0A6";

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

function Dashes({ flip }: { flip?: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: flip ? "row-reverse" : "row", gap: 6, opacity: 0.5 }}>
      <div style={{ width: 14, height: 14, backgroundColor: "#3A3D41" }} />
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div key={i} style={{ width: 6, height: 6, backgroundColor: "#3A3D41", marginTop: 4 }} />
      ))}
    </div>
  );
}

function Side({
  src,
  handle,
  likes,
  dim,
}: {
  src: string | null;
  handle: string;
  likes: string | null;
  dim: boolean;
}) {
  const ring = {
    width: 300,
    height: 300,
    borderRadius: 999,
    border: `5px solid ${LIME}`,
    boxShadow: `0 0 40px ${LIME_GLOW}`,
    display: "flex",
    overflow: "hidden",
    backgroundColor: CARD,
    opacity: dim ? 0.45 : 1,
  } as const;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 26 }}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} width={300} height={300} style={{ ...ring, objectFit: "cover" }} alt="" />
      ) : (
        <div style={ring} />
      )}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 42, fontWeight: 700, color: dim ? MUTED : INK }}>@{handle}</span>
        {likes && (
          <span style={{ fontSize: 30, fontWeight: 600, color: dim ? MUTED : LIME }}>
            {likes} likes
          </span>
        )}
      </div>
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
          backgroundColor: BG,
          padding: 26,
        }}
      >
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            borderRadius: 34,
            border: `2px solid ${LIME}`,
            boxShadow: `0 0 34px ${LIME_GLOW}`,
            backgroundColor: CARD,
            padding: "26px 46px 30px",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <Dashes />
            <span
              style={{
                fontSize: 58,
                fontWeight: 800,
                color: LIME,
                textShadow: `0 0 24px ${LIME_GLOW}`,
                marginTop: -8,
              }}
            >
              ratio
            </span>
            <Dashes flip />
          </div>
          <div
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 90,
            }}
          >
            <Side
              src={avatarA}
              handle={handleA}
              likes={settled ? fmtLikes(m?.likes_a_final ?? 0) : null}
              dim={winner === "b"}
            />
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 90 }}>
              <span
                style={{
                  fontSize: 66,
                  fontWeight: 800,
                  color: LIME,
                  textShadow: `0 0 28px ${LIME_GLOW}`,
                }}
              >
                vs
              </span>

            </div>
            <Side
              src={avatarB}
              handle={handleB}
              likes={settled ? fmtLikes(m?.likes_b_final ?? 0) : null}
              dim={winner === "a"}
            />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
            <Dashes />
            {settled ? (
              <span style={{ fontSize: 30, fontWeight: 700, color: MUTED }}>
                @{winner === "a" ? handleA : handleB} won
              </span>
            ) : (
              <span />
            )}
            <Dashes flip />
          </div>
        </div>
      </div>
    ),
    size,
  );
}
