/**
 * Mention -> intent. Ported from cue-wire: same deterministic regex fast-path
 * (an LLM layer can wrap it later — the engine only ever sees ParsedIntent).
 *
 * Stake grammar is handle-first (UI spec §4: users see two people, not
 * letters): `$25 @handle`, `@handle $25`, `$25 on @handle`. The A/B letter
 * grammar stays as a silent fallback — it costs nothing to accept and
 * tolerates early users copying each other.
 */

export type ParsedIntent =
  | { action: "create" }
  | { action: "bet"; side: 0 | 1 | { handle: string }; amountUsd: number }
  | { action: "ignore" };

const BET_HANDLE_RE =
  /\$?\s*(\d+(?:\.\d+)?)\s+(?:on\s+)?@(\w+)|@(\w+)\s+\$?\s*(\d+(?:\.\d+)?)/i;
// The reversed letter needs \b on BOTH sides: without it, a bare "$25"
// parses as side "2", amount 5 — a real money-routing bug.
const BET_LETTER_RE =
  /\$?\s*(\d+(?:\.\d+)?)\s*(?:on\s+)?([ab12])\b|\b([ab12])\b\s*\$?\s*(\d+(?:\.\d+)?)/i;
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
    const amount = Number(hm[1] ?? hm[4]);
    const handle = (hm[2] ?? hm[3]) as string;
    if (amount > 0) return { action: "bet", side: { handle }, amountUsd: amount };
  }

  const cleaned = withoutBot.replace(/@\w+/g, "").trim();

  const bet = cleaned.match(BET_LETTER_RE);
  if (bet) {
    const amount = Number(bet[1] ?? bet[4]);
    const sideRaw = (bet[2] ?? bet[3] ?? "").toLowerCase();
    const side: 0 | 1 = sideRaw === "a" || sideRaw === "1" ? 0 : 1;
    if (amount > 0) return { action: "bet", side, amountUsd: amount };
  }

  // Bare "@handle" on a tweet = "ratio this".
  if (CREATE_RE.test(cleaned) || cleaned.length === 0) return { action: "create" };

  return { action: "ignore" };
}

/** Mention text minus tags — used to tell a bare trigger from a take. */
export function substantiveText(text: string): string {
  return text.replace(/@\w+/g, "").replace(/https?:\/\/\S+/g, "").trim();
}
