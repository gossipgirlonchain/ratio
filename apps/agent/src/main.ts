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

import {
  BOT_HANDLE,
  FEE_SHARE_BPS,
  FRESHNESS_WINDOW_MS,
  LAMPORTS_PER_USD,
  HIDDEN_REPORT_THRESHOLD,
  LIKES_SAMPLE_INTERVAL_MS,
  MARKET_DURATION_MS,
  MAX_STAKE_USD,
  MIN_STAKE_USD,
  SEED_PER_SIDE_USD,
  SWAP_FEE_BPS,
  marketUrl,
} from "@ratio/config";
import { RatioMarketClient } from "@ratio/doppler/pair-market";
import { createClients } from "@ratio/doppler/tx";
import { createKeyPairSignerFromBytes } from "@solana/kit";

import { DopplerMarketChain } from "./chainDevnet.js";
import { RatioEngine } from "./engine.js";
import { PrivyWalletProvider } from "./privyWallets.js";
import { SupabaseStore } from "./storeSupabase.js";
import { XApiClient } from "./xApi.js";
import { StreamedXClient, ensureStreamRule } from "./xStream.js";

const REQUIRED = [
  "X_API_KEY",
  "X_API_SECRET",
  "X_ACCESS_TOKEN",
  "X_ACCESS_SECRET",
  "X_BEARER_TOKEN",
] as const;

const HEARTBEAT_MS = 5 * 60 * 1000;

const shutdownHooks: Array<() => void> = [];
const onShutdown = (fn: () => void) => shutdownHooks.push(fn);
for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, () => {
    console.log(`${sig} received, shutting down`);
    for (const fn of shutdownHooks) fn();
    process.exit(0);
  });
}

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

  // Identity from env when provided — a boot must not spend API reads
  // on things we already know. /users/me runs only as a fallback.
  const me = process.env.RATIO_BOT_USER_ID
    ? { id: process.env.RATIO_BOT_USER_ID, username: process.env.RATIO_BOT_HANDLE ?? "ratiowtf" }
    : await whoAmI();
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

  // Read-only mention probe on a THROWAWAY client: the probe must never
  // advance the cursor of the client the engine trades with, or it
  // silently steals pre-boot mentions from the catch-up poll.
  // NO probe read: boots must not bill. The armed catch-up poll is the
  // one and only boot-time read; disarmed mode reads nothing at all.
  const x = new XApiClient({
    apiKey: process.env.X_API_KEY!,
    apiSecret: process.env.X_API_SECRET!,
    accessToken: process.env.X_ACCESS_TOKEN!,
    accessSecret: process.env.X_ACCESS_SECRET!,
    botUserId: me.id,
  });

  // ------------------------------------------------------------------
  // THE LATCH. RATIO_ARMED=1 is the ONLY thing that lets this process
  // post tweets or touch the chain. Anything else = observe-only.
  // ------------------------------------------------------------------
  if (process.env.RATIO_ARMED !== "1") {
    console.log("trading loop DISARMED (set RATIO_ARMED=1 to arm). Heartbeating.");
    const beat = setInterval(() => {
      console.log(`heartbeat: alive, loop disarmed (${new Date().toISOString()})`);
    }, HEARTBEAT_MS);
    onShutdown(() => clearInterval(beat));
    return;
  }

  // -- ARMED: assemble the same machine the devnet sim proves ---------
  const operatorBytes = process.env.OPERATOR_KEYPAIR;
  if (!operatorBytes) {
    console.error("armed but OPERATOR_KEYPAIR missing — refusing to start");
    process.exit(1);
  }
  const clients = createClients();
  const operator = await createKeyPairSignerFromBytes(
    new Uint8Array(JSON.parse(operatorBytes)),
  );
  const balance = await clients.rpc.getBalance(operator.address).send();
  console.log(`ARMED. operator ${operator.address}, ${Number(balance.value) / 1e9} SOL`);
  if (Number(balance.value) < 200_000_000) {
    console.error("WARNING: operator under 0.2 SOL — launches will start failing soon");
  }

  const store = new SupabaseStore(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
  const wallets = new PrivyWalletProvider(
    { appId: process.env.PRIVY_APP_ID!, appSecret: process.env.PRIVY_APP_SECRET! },
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
  );
  const marketClient = await RatioMarketClient.create({ clients, operator });
  const chain = new DopplerMarketChain(clients, marketClient, {
    swapFeeBps: SWAP_FEE_BPS,
    lamportsPerUsd: LAMPORTS_PER_USD,
    signerFor: (addr) => (addr === operator.address ? operator : wallets.signerFor(addr)),
    operatorAddress: operator.address,
    sponsorAddress: (await wallets.getWallet("ratio:treasury")).address,
    labelsFor: async (marketId) => {
      const record = await store.getMarketByTweet(marketId);
      if (!record) throw new Error(`labelsFor: no market ${marketId} on record`);
      return [`A @${record.authorAHandle}`, `B @${record.authorBHandle}`];
    },
  });
  // Push, not poll: mentions arrive over the filtered stream; the only
  // billed reads are one catch-up at boot and one per reconnect.
  await ensureStreamRule(process.env.X_BEARER_TOKEN!, BOT_HANDLE);
  const streamed = new StreamedXClient(x, process.env.X_BEARER_TOKEN!, me.id);
  streamed.start();
  onShutdown(() => streamed.stop());

  const engine = new RatioEngine(streamed, store, wallets, chain, {
    botHandle: BOT_HANDLE,
    freshnessWindowMs: FRESHNESS_WINDOW_MS,
    marketDurationMs: MARKET_DURATION_MS,
    seedPerSideUsd: SEED_PER_SIDE_USD,
    likesSampleIntervalMs: LIKES_SAMPLE_INTERVAL_MS,
    minStakeUsd: MIN_STAKE_USD,
    maxStakeUsd: MAX_STAKE_USD,
    hiddenReportThreshold: HIDDEN_REPORT_THRESHOLD,
    // operator doubles as treasury on devnet: seeds sign + fund from it
    protocolWallet: operator.address,
    // distinct from the protocol wallet — the initializer rejects
    // duplicate beneficiaries, and defaulting both to the operator was
    // exactly that. A dedicated Privy wallet fills the slot when no
    // explicit address is configured.
    dopplerWallet:
      process.env.DOPPLER_FEE_WALLET ??
      (await wallets.getWallet("ratio:doppler-fee")).address,
    feeShareBps: FEE_SHARE_BPS,
    marketUrl,
    now: () => Date.now(),
  });

  // Crons: chained timers (never overlapping runs of the same job), each
  // failure logged and retried next tick — the engine is built for that.
  // Mention tick drains the local stream queue — free — so it can be
  // snappy. The env name survives for ops muscle memory.
  const MENTION_MS = Number(process.env.RATIO_MENTION_POLL_MS ?? 15_000);
  const SETTLE_MS = Number(process.env.RATIO_SETTLE_POLL_MS ?? 60_000);
  const SAMPLE_MS = Number(process.env.RATIO_SAMPLER_POLL_MS ?? 300_000);
  const cron = (label: string, ms: number, run: () => Promise<void>) => {
    let stopped = false;
    const loop = async () => {
      if (stopped) return;
      try {
        await run();
      } catch (err) {
        console.error(`${label} tick failed:`, (err as Error).message.slice(0, 200));
      }
      if (!stopped) setTimeout(loop, ms);
    };
    setTimeout(loop, ms);
    onShutdown(() => {
      stopped = true;
    });
    console.log(`cron armed: ${label} every ${ms / 1000}s`);
  };
  cron("mentions", MENTION_MS, () => engine.tick());
  cron("settlement", SETTLE_MS, () => engine.resolveDueMarkets());
  cron("likes-sampler", SAMPLE_MS, () => engine.sampleLikesDueMarkets());
  console.log("ratio agent ARMED and trading. @" + me.username + " is live.");

}

main().catch((err) => {
  console.error("agent failed to start:", err);
  process.exit(1);
});
