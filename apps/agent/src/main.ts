/**
 * The deployed agent process (Railway). Right now this is the SAFETY
 * VERSION: it proves the X credentials work and heartbeats — the trading
 * loop stays DISARMED until the real Store (Supabase) and XClient land.
 * It must never post a tweet from a bare deploy.
 *
 * Env: see .env.example. Reads OAuth 1.0a user-context credentials (the
 * non-expiring pair) and identifies the bot via GET /2/users/me.
 */
import { createHmac, randomBytes } from "node:crypto";

import { SupabaseStore } from "./storeSupabase.js";
import { XApiClient } from "./xApi.js";

const REQUIRED = [
  "X_API_KEY",
  "X_API_SECRET",
  "X_ACCESS_TOKEN",
  "X_ACCESS_SECRET",
  "X_BEARER_TOKEN",
] as const;

const HEARTBEAT_MS = 5 * 60 * 1000;

const pct = (s: string) =>
  encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/** Minimal OAuth 1.0a HMAC-SHA1 signer — enough for v2 user-context GETs
 * and (later) POSTs. No third-party auth dependency. */
function oauth1Header(method: string, url: string): string {
  const params: Record<string, string> = {
    oauth_consumer_key: process.env.X_API_KEY!,
    oauth_nonce: randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_token: process.env.X_ACCESS_TOKEN!,
    oauth_version: "1.0",
  };
  const base = [
    method.toUpperCase(),
    pct(url),
    pct(
      Object.keys(params)
        .sort()
        .map((k) => `${pct(k)}=${pct(params[k]!)}`)
        .join("&"),
    ),
  ].join("&");
  const key = `${pct(process.env.X_API_SECRET!)}&${pct(process.env.X_ACCESS_SECRET!)}`;
  params.oauth_signature = createHmac("sha1", key).update(base).digest("base64");
  return (
    "OAuth " +
    Object.keys(params)
      .sort()
      .map((k) => `${pct(k)}="${pct(params[k]!)}"`)
      .join(", ")
  );
}

async function whoAmI(): Promise<{ id: string; username: string }> {
  const url = "https://api.twitter.com/2/users/me";
  const res = await fetch(url, { headers: { Authorization: oauth1Header("GET", url) } });
  if (!res.ok) {
    throw new Error(`GET /2/users/me -> ${res.status}: ${await res.text()}`);
  }
  const body = (await res.json()) as { data: { id: string; username: string } };
  return body.data;
}

async function main() {
  const missing = REQUIRED.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    console.error(`missing env: ${missing.join(", ")} — see apps/agent/.env.example`);
    process.exit(1);
  }

  const me = await whoAmI();
  console.log(`ratio agent up as @${me.username} (x id ${me.id})`);
  if (process.env.RATIO_BOT_HANDLE && me.username.toLowerCase() !== process.env.RATIO_BOT_HANDLE.toLowerCase()) {
    console.error(
      `WARNING: authenticated as @${me.username} but RATIO_BOT_HANDLE=${process.env.RATIO_BOT_HANDLE} — wrong account's access token?`,
    );
  }

  // Prove the store the same way we prove X: connect and read.
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) {
    const store = new SupabaseStore(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    const open = await store.listOpenMarketsDue(Date.now() + 365 * 24 * 3_600_000);
    console.log(`store connected: supabase reachable, ${open.length} open markets on record`);
  } else {
    console.log("store NOT configured (SUPABASE_URL / SUPABASE_SERVICE_KEY missing)");
  }

  // Read-only mention probe: proves the XClient path without acting on
  // anything. Failures (e.g. 402 credits depleted) log and never crash.
  const x = new XApiClient({
    apiKey: process.env.X_API_KEY!,
    apiSecret: process.env.X_API_SECRET!,
    accessToken: process.env.X_ACCESS_TOKEN!,
    accessSecret: process.env.X_ACCESS_SECRET!,
    botUserId: me.id,
  });
  try {
    const mentions = await x.fetchMentions();
    console.log(`xclient ok: ${mentions.length} mention(s) visible (read-only, not acting)`);
  } catch (err) {
    console.log(`xclient read failed (non-fatal): ${(err as Error).message.slice(0, 160)}`);
  }

  console.log("trading loop DISARMED: engine assembly pending. Heartbeating.");
  const beat = setInterval(() => {
    console.log(`heartbeat: alive, loop disarmed (${new Date().toISOString()})`);
  }, HEARTBEAT_MS);

  const bye = (sig: string) => {
    console.log(`${sig} received, shutting down`);
    clearInterval(beat);
    process.exit(0);
  };
  process.on("SIGTERM", () => bye("SIGTERM"));
  process.on("SIGINT", () => bye("SIGINT"));
}

main().catch((err) => {
  console.error("agent failed to start:", err);
  process.exit(1);
});
