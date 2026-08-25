/**
 * Server-only Supabase client (service role — bypasses RLS). Imported by
 * API routes only; never from a client component. The service key exists
 * exclusively in server env.
 */
import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

export function supabaseAdmin(): SupabaseClient {
  if (!client) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_KEY;
    if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_KEY not configured");
    client = createClient(url, key, {
      auth: { persistSession: false },
      // Next.js patches fetch and CACHES GETs (Vercel's data cache even
      // survives deploys) — every PostgREST read would be a frozen
      // snapshot. Live data non-negotiable: no-store on every request.
      global: { fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }) },
    });
  }
  return client;
}
