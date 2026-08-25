/**
 * Admin: generate + list access codes. Auth = x-admin-key header
 * compared against ADMIN_KEY (the admin is one person with a secret,
 * not a user system).
 */
import { randomBytes } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { supabaseAdmin } from "../../../../lib/supabaseServer";

const authed = (req: NextRequest): boolean =>
  !!process.env.ADMIN_KEY && req.headers.get("x-admin-key") === process.env.ADMIN_KEY;

/** Unambiguous alphabet: no 0/O/1/I/L. */
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const chunk = (): string =>
  Array.from(randomBytes(4), (b) => ALPHABET[b % ALPHABET.length]).join("");
const newCode = (): string => `RATIO-${chunk()}-${chunk()}`;

export async function GET(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: "nope" }, { status: 401 });
  const { data, error } = await supabaseAdmin()
    .from("access_codes")
    .select()
    .order("created_at_ms", { ascending: false })
    .limit(500);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ codes: data });
}

export async function POST(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: "nope" }, { status: 401 });
  const { code, note, uses = 1 } = (await req.json().catch(() => ({}))) as {
    code?: string;
    note?: string;
    uses?: number;
  };
  const maxUses = Math.max(1, Math.min(100_000, Math.floor(uses)));
  // A typed code is THE code (uppercased, like redemption normalizes);
  // blank means mint a random one.
  let value = (code ?? "").trim().toUpperCase();
  if (value && !/^[A-Z0-9-]{3,32}$/.test(value)) {
    return NextResponse.json({ error: "codes are 3-32 letters, numbers, dashes" }, { status: 400 });
  }
  if (!value) value = newCode();
  const { error } = await supabaseAdmin().from("access_codes").insert({
    code: value,
    created_at_ms: Date.now(),
    note: note ?? null,
    max_uses: maxUses,
  });
  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "that code already exists" }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ codes: [value] });
}
