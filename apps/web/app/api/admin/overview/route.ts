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
  const [markets, bets, codes, wallets] = await Promise.all([
    db.from("markets").select().order("created_at_ms", { ascending: false }).limit(200),
    db.from("bets").select("market_id, x_user_id, handle, amount_usd, is_seed, placed_at_ms"),
    db.from("access_codes").select("code, redeemed_at_ms"),
    db.from("wallets").select("x_user_id, address, created_at_ms").order("created_at_ms", { ascending: false }),
  ]);
  for (const r of [markets, bets, codes, wallets]) {
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
  // Users = every provisioned wallet that is a person (system wallets are
  // "ratio:" prefixed), annotated with their betting footprint.
  const byUser = new Map<string, { handle: string | null; bets: number; stakedUsd: number; lastBetMs: number | null }>();
  for (const b of real) {
    const u = byUser.get(b.x_user_id) ?? { handle: null, bets: 0, stakedUsd: 0, lastBetMs: null };
    u.handle = (b.handle as string) ?? u.handle;
    u.bets += 1;
    u.stakedUsd += Number(b.amount_usd);
    u.lastBetMs = Math.max(u.lastBetMs ?? 0, Number(b.placed_at_ms));
    byUser.set(b.x_user_id, u);
  }
  const users = (wallets.data ?? [])
    .filter((w) => !String(w.x_user_id).startsWith("ratio:"))
    .map((w) => ({
      xUserId: w.x_user_id as string,
      address: w.address as string,
      createdAtMs: Number(w.created_at_ms),
      ...(byUser.get(w.x_user_id as string) ?? { handle: null, bets: 0, stakedUsd: 0, lastBetMs: null }),
    }));

  return NextResponse.json({ stats: { ...stats, users: users.length }, markets: markets.data, users });
}
