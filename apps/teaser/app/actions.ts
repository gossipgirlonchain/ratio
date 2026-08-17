"use server";

/**
 * One action: opponent tapped → market exists → screen 5. No confirm step
 * (spec). The bot's market-open post happens at creation time — open
 * question 3 (post at pick vs at user's QT) is currently answered "at
 * pick"; if that flips, this is the only place that changes.
 */

import { redirect } from "next/navigation";
import { createMarket, existingMarketForPair } from "../lib/markets";
import { mockX } from "../lib/mockX";
import { normalizeHandle } from "../lib/types";

export async function pickOpponent(formData: FormData) {
  const handle = normalizeHandle(String(formData.get("handle") ?? ""));
  const replyId = String(formData.get("replyId") ?? "");
  const opponentTweetId = String(formData.get("opponentTweetId") ?? "");

  const res = await mockX.lookup(handle);
  if (!res.ok) redirect(`/${handle}`);
  const reply = res.replies.find((r) => r.id === replyId);
  if (!reply) redirect(`/${handle}/fights`);
  const opponent = (await mockX.opponents(reply.parent.id, handle)).find(
    (o) => o.tweetId === opponentTweetId,
  );
  if (!opponent) redirect(`/${handle}/fights`);

  const made = createMarket(res.user, reply, opponent);
  if (!made.ok) {
    // duplicate pair: converting to the existing market beats a bare error
    const dupe = existingMarketForPair(reply.id, opponent.tweetId);
    if (dupe) redirect(`/m/${dupe.id}`);
    redirect(`/${handle}/fights`);
  }
  redirect(`/m/${made.market.id}?fresh=1`);
}
