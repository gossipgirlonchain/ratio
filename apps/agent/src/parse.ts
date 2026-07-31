/**
 * Mention -> intent. Ported from cue-wire: same deterministic regex fast-path,
 * same bet grammar (an LLM layer can wrap it later — the engine only ever
 * sees ParsedIntent). Deleted with the old mechanic: the duration grammar
 * (every ratio market is a fixed 24h) and poll-option text matching.
 */

export type ParsedIntent =
  | { action: "create" }
  | { action: "bet"; side: 0 | 1; amountUsd: number }
  | { action: "ignore" };

const BET_RE =
  /\$?\s*(\d+(?:\.\d+)?)\s*(?:on\s+)?([ab12])\b|([ab12])\s*\$?\s*(\d+(?:\.\d+)?)/i;
const CREATE_RE = /\b(market( this)?|ratio( this| that| them)?|create|open)\b/i;

export function parseMention(text: string): ParsedIntent {
  const cleaned = text.replace(/@\w+/g, "").trim();

  const bet = cleaned.match(BET_RE);
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
