/**
 * Real web bets: the viewer's Privy server wallet signs a swap on the
 * chosen side's curve.
 *
 * Everything chain-shaped now goes through MarketChain (lib/chain.ts) —
 * refs recovery, sponsorship, the swap itself, and the balance check are
 * all its business. What is left here is the part that is genuinely ours:
 * who the viewer is, whether this market will accept the stake, and
 * recording the trade.
 */
import "server-only";

import { MAX_STAKE_USD, MIN_STAKE_USD } from "@ratio/config";

import { marketChain } from "./chain";
import { supabaseAdmin } from "./supabaseServer";
import { getOrCreateWallet, type Viewer } from "./walletServer";

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

  const chain = await marketChain();
  const wallet = await getOrCreateWallet(viewer.xUserId, viewer.handle);
  const balance = await chain.balanceUsd(wallet.address);
  if (amountUsd > balance - 0.05) {
    throw new Error(`not enough in your wallet ($${balance.toFixed(2)} available)`);
  }

  const result = await chain.placeBet({
    refs: { marketId },
    side: side === "a" ? 0 : 1,
    amountUsd,
    bettor: wallet.address,
  });

  const { error: betErr } = await db.from("bets").insert({
    market_id: marketId,
    x_user_id: viewer.xUserId,
    handle: viewer.handle,
    side: side === "a" ? 0 : 1,
    direction: "buy",
    amount_usd: amountUsd,
    // Zero on Solana: the position lives in the bettor's associated token
    // account and the swap never reports it back. The EVM settlement
    // contract emits it (contracts/EVENTS.md, BetPlaced.tokensOut), which
    // is what finally makes every token-weighted number in the product
    // real rather than divided-by-zero.
    tokens_out: result.tokensOut,
    placed_at_ms: Date.now(),
    is_seed: false,
  });
  if (betErr) {
    // The stake LANDED on-chain; a failed record must scream, not hide.
    throw new Error(
      `bet landed on-chain (${result.signature}) but recording failed: ${betErr.message}`,
    );
  }
  return { signature: result.signature };
}
