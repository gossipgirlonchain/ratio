/**
 * Redeem an access code: burn it (single use), mint the signed cookie.
 * Public by design — it IS the front door.
 */
import { NextResponse, type NextRequest } from "next/server";

import { ACCESS_COOKIE, signAccess } from "../../../../lib/access";
import { supabaseAdmin } from "../../../../lib/supabaseServer";

export async function POST(req: NextRequest) {
  const secret = process.env.ACCESS_COOKIE_SECRET;
  if (!secret) return NextResponse.json({ error: "wall not configured" }, { status: 500 });

  const { code } = (await req.json().catch(() => ({}))) as { code?: string };
  const normalized = (code ?? "").trim().toUpperCase();
  if (!normalized) return NextResponse.json({ error: "no code" }, { status: 400 });

  const db = supabaseAdmin();
  // atomic burn: increments use_count only while under max_uses
  const { data, error } = await db.rpc("redeem_access_code", {
    p_code: normalized,
    p_by: req.headers.get("user-agent")?.slice(0, 120) ?? null,
  });
  if (error) return NextResponse.json({ error: "store error" }, { status: 500 });
  if (!data) {
    return NextResponse.json({ error: "that code is not valid or already used" }, { status: 403 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(ACCESS_COOKIE, await signAccess(secret, normalized), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 90, // the beta won't outlive this cookie
    path: "/",
  });
  return res;
}
