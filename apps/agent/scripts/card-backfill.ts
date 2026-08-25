/**
 * One-off: post the market card for a market whose card tweet failed
 * (side B thread was reply-restricted) and record its id.
 * Usage: npx tsx --env-file=../../.env --env-file=.env scripts/card-backfill.ts <marketId> <mentionTweetId>
 */
import { marketUrl } from "@ratio/config";
import { marketCard } from "@ratio/config/copy";
import { createClient } from "@supabase/supabase-js";

import { XApiClient } from "../src/xApi.js";

const [marketId, mentionTweetId] = process.argv.slice(2);
if (!marketId || !mentionTweetId) throw new Error("usage: card-backfill.ts <marketId> <mentionTweetId>");

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
const { data: m, error } = await supabase.from("markets").select("*").eq("id", marketId).single();
if (error || !m) throw new Error(`market not found: ${error?.message}`);
if (m.card_tweet_id) throw new Error(`card already posted: ${m.card_tweet_id}`);

const x = new XApiClient({
  apiKey: process.env.X_API_KEY!,
  apiSecret: process.env.X_API_SECRET!,
  accessToken: process.env.X_ACCESS_TOKEN!,
  accessSecret: process.env.X_ACCESS_SECRET!,
  botUserId: process.env.RATIO_BOT_USER_ID!,
});

const card = await x.postQuote({
  quoteTweetId: m.tweet_a_id,
  text: marketCard({
    quotedHandle: m.author_a_handle,
    opponentHandle: m.author_b_handle,
    closesInMs: Number(m.settles_at_ms) - Date.now(),
  }),
  link: marketUrl(marketId),
});
const { error: upErr } = await supabase.from("markets").update({ card_tweet_id: card.tweetId }).eq("id", marketId);
if (upErr) throw new Error(`card posted (${card.tweetId}) but db update failed: ${upErr.message}`);
console.log(`card posted: https://x.com/ratiowtf/status/${card.tweetId}`);
