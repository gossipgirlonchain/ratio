/**
 * Mention -> intent. Ported from cue-wire: same deterministic regex fast-path
 * (an LLM layer can wrap it later — the engine only ever sees ParsedIntent).
 *
 * Stake grammar is handle-first (UI spec §4: users see two people, not
 * letters): `0.01 @handle`, `@handle 0.01`, `$25 on @handle`. The A/B letter
 * grammar stays as a silent fallback — it costs nothing to accept and
 * tolerates early users copying each other.
 *
 * BOTH UNITS ARE ACCEPTED, because both kinds of person show up: "$25" from
 * someone thinking in dollars, "0.01" from someone thinking in ETH. They
 * become the same ETH transaction at the live rate.
 *
 * The disambiguation rule is deliberately blunt: a leading `$` means dollars,
 * anything else means ETH. That leaves a bare "25" reading as 25 ETH, which is
 * far above the stake cap and gets rejected — the failure mode is a refused
 * bet, never a bet a hundred times larger than intended. An explicit "eth" or
 * "Ξ" suffix is accepted too, since people write it.
 */

export type StakeUnit = "usd" | "eth";

export type ParsedIntent =
  | { action: "create" }
  | { action: "bet"; side: 0 | 1 | { handle: string }; amount: number; unit: StakeUnit }
  | { action: "ignore" };

// `($)? amount (eth)?` in either order relative to the handle. The currency
// marks are captured, not discarded, because they decide the unit.
const BET_HANDLE_RE =
  /(\$)?\s*(\d+(?:\.\d+)?)\s*(eth|Ξ)?\s+(?:on\s+)?@(\w+)|@(\w+)\s+(\$)?\s*(\d+(?:\.\d+)?)\s*(eth|Ξ)?/i;
// The reversed letter needs \b on BOTH sides: without it, a bare "$25"
// parses as side "2", amount 5 — a real money-routing bug.
const BET_LETTER_RE =
  /(\$)?\s*(\d+(?:\.\d+)?)\s*(eth|Ξ)?\s*(?:on\s+)?([ab12])\b|\b([ab12])\b\s*(\$)?\s*(\d+(?:\.\d+)?)\s*(eth|Ξ)?/i;

/** `$` means dollars. Everything else, including bare numbers, means ETH. */
const unitOf = (dollar: string | undefined): StakeUnit => (dollar ? "usd" : "eth");
const CREATE_RE = /\b(market( this)?|ratio( this| that| them)?|create|open)\b/i;

export function parseMention(text: string, botHandle?: string): ParsedIntent {
  // Strip the bot's own tag FIRST: it is never a side, and left in place it
  // shadows the real match ("@bot $25 @cora" must read as "$25 @cora").
  const withoutBot = botHandle
    ? text.replace(new RegExp(`@${botHandle}\\b`, "gi"), " ")
    : text;

  // Handle-based stake — the remaining handles carry the side.
  const hm = withoutBot.match(BET_HANDLE_RE);
  if (hm) {
    const amount = Number(hm[2] ?? hm[7]);
    const handle = (hm[4] ?? hm[5]) as string;
    const unit = unitOf(hm[1] ?? hm[6]);
    if (amount > 0) return { action: "bet", side: { handle }, amount, unit };
  }

  const cleaned = withoutBot.replace(/@\w+/g, "").trim();

  const bet = cleaned.match(BET_LETTER_RE);
  if (bet) {
    const amount = Number(bet[2] ?? bet[7]);
    const sideRaw = (bet[4] ?? bet[5] ?? "").toLowerCase();
    const side: 0 | 1 = sideRaw === "a" || sideRaw === "1" ? 0 : 1;
    const unit = unitOf(bet[1] ?? bet[6]);
    if (amount > 0) return { action: "bet", side, amount, unit };
  }

  /**
   * A market opens when someone TAGS the bot. Not when someone says our name.
   *
   * The mentions timeline hands us every reply to our own posts, tag or no
   * tag, and CREATE_RE matches the bare word "ratio" — so on 9 September a
   * reply to one of our announcements reading only "RATIO", with no tag
   * anywhere in it, parsed as a create and opened a market between our post
   * and that reply. The bot then posted a card for it. Nobody asked for any
   * of it.
   *
   * `cleaned.length === 0` was the other half: an empty reply also created.
   * Both faults are the same assumption, that anything reaching this function
   * was addressed to us.
   *
   * A STAKE is different and is deliberately still accepted untagged: it
   * carries an explicit amount, and it only does anything if it is a reply to
   * a live market card, which X does not hand us by accident.
   */
  if (botHandle && !new RegExp(`@${botHandle}\\b`, "i").test(text)) {
    return { action: "ignore" };
  }

  // Bare "@handle" on a tweet = "ratio this".
  if (CREATE_RE.test(cleaned) || cleaned.length === 0) return { action: "create" };

  return { action: "ignore" };
}

/** Mention text minus tags — used to tell a bare trigger from a take. */
export function substantiveText(text: string): string {
  return text.replace(/@\w+/g, "").replace(/https?:\/\/\S+/g, "").trim();
}
