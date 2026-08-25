/**
 * Real web bets: the viewer's Privy server wallet signs a swap on the
 * chosen side's curve. Refs are RECOVERED from chain (recoverRefs) using
 * only the market row — no process state, so this works from any web
 * instance regardless of which container launched the market.
 */
import "server-only";

import { MAX_STAKE_USD, MIN_STAKE_USD } from "@ratio/config";
import { RatioMarketClient, recoverRefs, type PairMarketRefs } from "@ratio/doppler/pair-market";
import { createClients, type Clients } from "@ratio/doppler/tx";
import { address } from "@solana/kit";

import { supabaseAdmin } from "./supabaseServer";
import { balanceUsd, getOrCreateWallet, LAMPORTS_PER_USD, privySigner, type Viewer } from "./walletServer";

/** The agent hot wallet that creates markets — oracle PDAs derive from it.
 * Public info (it signs every market on-chain), env-overridable. */
const OPERATOR_ADDRESS =
  process.env.RATIO_OPERATOR_ADDRESS ?? "H7VpbRU72x1X8z4kv18YMzSmzcxuTSqCbBiRS3NaDmQV";

let clients: Clients | null = null;
const getClients = () => (clients ??= createClients());

/** Refs never change after launch: recover once per market per instance. */
const refsCache = new Map<string, PairMarketRefs>();

async function refsFor(m: {
  id: string;
  author_a_handle: string;
  author_b_handle: string;
}): Promise<PairMarketRefs> {
  const hit = refsCache.get(m.id);
  if (hit) return hit;
  const refs = await recoverRefs({
    clients: getClients(),
    operatorAddress: address(OPERATOR_ADDRESS),
    nonce: BigInt(m.id),
    labels: [`A @${m.author_a_handle}`, `B @${m.author_b_handle}`],
  });
  refsCache.set(m.id, refs);
  return refs;
}

export async function placeRealBet(
  viewer: Viewer,
  marketId: string,
  side: "a" | "b",
  amountUsd: number,
): Promise<{ signature: string }> {
  const db = supabaseAdmin();
  const { data: m, error } = await db.from("markets").select().eq("id", marketId).maybeSingle();
  if (error) throw new Error(`market lookup: ${error.message}`);
  if (!m) throw new Error("no such market");
  if (m.status !== "open") throw new Error("market is decided");
  if (Date.now() >= Number(m.settles_at_ms)) throw new Error("market has ended");
  if (amountUsd < MIN_STAKE_USD) throw new Error(`minimum stake is $${MIN_STAKE_USD}`);
  if (amountUsd > MAX_STAKE_USD) throw new Error(`maximum stake is $${MAX_STAKE_USD}`);

  const wallet = await getOrCreateWallet(viewer.xUserId);
  const balance = await balanceUsd(wallet.address);
  if (amountUsd > balance - 0.05) {
    throw new Error(`not enough in your wallet ($${balance.toFixed(2)} available)`);
  }

  const refs = await refsFor(m);
  const bettor = privySigner(wallet.privy_wallet_id, wallet.address);
  // placeBet never touches the operator role; the client just needs a signer.
  const client = await RatioMarketClient.create({ clients: getClients(), operator: bettor });
  const result = await client.placeBet({
    refs,
    side: side === "a" ? 0 : 1,
    amountIn: BigInt(Math.round(amountUsd)) * LAMPORTS_PER_USD,
    bettor,
    wrapSol: true,
  });

  const { error: betErr } = await db.from("bets").insert({
    market_id: marketId,
    x_user_id: viewer.xUserId,
    handle: viewer.handle,
    side: side === "a" ? 0 : 1,
    direction: "buy",
    amount_usd: amountUsd,
    tokens_out: 0, // token amount lives in the bettor's ATA on-chain
    placed_at_ms: Date.now(),
    is_seed: false,
  });
  if (betErr) {
    // The stake LANDED on-chain; a failed record must scream, not hide.
    throw new Error(`bet landed on-chain (${result.signature}) but recording failed: ${betErr.message}`);
  }
  return { signature: result.signature };
}
