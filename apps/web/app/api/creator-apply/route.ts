/**
 * Creator application intake. Public by design — the form at /creator-apply
 * sits outside the access wall and posts here. Server-side validation
 * mirrors the form's rules: never trust the static page.
 */
import { NextResponse, type NextRequest } from "next/server";

import { supabaseAdmin } from "../../../lib/supabaseServer";

const BANDS_FOLLOWERS = new Set(["Under 5K", "5K–15K", "15K–50K", "50K–150K", "150K+"]);
const BANDS_VIEWS = new Set(["Under 5K", "5K–20K", "20K–75K", "75K–250K", "250K+"]);
const isXUrl = (v: unknown) => {
  if (typeof v !== "string") return false;
  try {
    const h = new URL(v).hostname.replace(/^www\./, "");
    return h === "x.com" || h === "twitter.com" || h.endsWith(".x.com") || h.endsWith(".twitter.com");
  } catch {
    return false;
  }
};
const str = (v: unknown, max = 300) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const rate = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : null;

export async function POST(req: NextRequest) {
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b) return NextResponse.json({ error: "bad payload" }, { status: 400 });

  const name = str(b.name, 120);
  const xHandle = str(b.x_handle, 60).replace(/^@+/, "");
  const tgHandle = str(b.telegram_handle, 60).replace(/^@+/, "");
  const followers = str(b.followers, 20);
  const avgViews = str(b.avg_views_30d, 20);
  const audience = Array.isArray(b.audience)
    ? b.audience.filter((a): a is string => typeof a === "string").map((a) => a.slice(0, 80)).slice(0, 3)
    : [];
  const posts = Array.isArray(b.best_posts) ? b.best_posts.filter(isXUrl).slice(0, 2) : [];
  const wallet = str(b.sol_wallet, 60) || null;

  if (
    !name || !xHandle || !tgHandle || audience.length === 0 || posts.length !== 2 ||
    !BANDS_FOLLOWERS.has(followers) || !BANDS_VIEWS.has(avgViews) ||
    (wallet && !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet))
  ) {
    return NextResponse.json({ error: "missing or invalid fields" }, { status: 400 });
  }

  const rawRates = (b.rates ?? {}) as Record<string, unknown>;
  const rates: Record<string, number> = {};
  for (const k of [
    "video_30s", "standing_post", "thread", "quote_tweet", "retweet",
    "comment", "telegram_post", "pinned_24h_addon", "bundle",
  ]) {
    const r = rate(rawRates[k]);
    if (r !== null) rates[k] = r;
  }

  const { error } = await supabaseAdmin().from("creator_applications").insert({
    name,
    x_handle: xHandle,
    followers,
    avg_views_30d: avgViews,
    audience,
    telegram_handle: tgHandle,
    telegram_channel: str(b.telegram_channel, 300) || null,
    best_posts: posts,
    rates,
    sol_wallet: wallet,
    notes: str(b.notes, 4000) || null,
  });
  if (error) return NextResponse.json({ error: "store error" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
