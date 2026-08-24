/**
 * Admin: the live store at a glance — every market plus topline stats,
 * straight from Supabase (the same rows the agent writes).
 */
import { NextResponse, type NextRequest } from "next/server";

import { supabaseAdmin } from "../../../../lib/supabaseServer";

const authed = (req: NextRequest): boolean =>
  !!process.env.ADMIN_KEY && req.headers.get("x-admin-key") === process.env.ADMIN_KEY;

export async function GET(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: "nope" }, { status: 401 });
  const db = supabaseAdmin();
  const [markets, bets, codes] = await Promise.all([
    db.from("markets").select().order("created_at_ms", { ascending: false }).limit(200),
    db.from("bets").select("market_id, x_user_id, amount_usd, is_seed, placed_at_ms"),
    db.from("access_codes").select("code, redeemed_at_ms"),
  ]);
  for (const r of [markets, bets, codes]) {
    if (r.error) return NextResponse.json({ error: r.error.message }, { status: 500 });
  }
  const allBets = bets.data ?? [];
  const real = allBets.filter((b) => !b.is_seed);
  const stats = {
    markets: (markets.data ?? []).length,
    open: (markets.data ?? []).filter((m) => m.status === "open").length,
    settled: (markets.data ?? []).filter((m) => m.status !== "open").length,
    grossStakedUsd: real.reduce((s, b) => s + Number(b.amount_usd), 0),
    bettors: new Set(real.map((b) => b.x_user_id)).size,
    bets: real.length,
    codesTotal: (codes.data ?? []).length,
    codesRedeemed: (codes.data ?? []).filter((c) => c.redeemed_at_ms).length,
  };
  return NextResponse.json({ stats, markets: markets.data });
}
