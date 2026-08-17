"use client";

/**
 * Market scanner (docs/scanner-spec.md, pulled forward 2026-08-13).
 * Alerts only — NO auto-execution, ever, without its own workstream.
 *
 * Users describe what they want in plain English; parseRule turns it into
 * an AND-combined condition set, the panel echoes it back, and only a
 * confirmed draft becomes a rule. Rules evaluate on the likes-sampler
 * cadence (that is when the data changes) and fire ONCE per rule per
 * market — the fired log is permanent, no repeat alerts.
 *
 * All state lives at module level + localStorage, so the panel keeps its
 * conversation and rules across route changes without living in a rail
 * that some pages don't have.
 *
 * Fixture world: evaluation runs client-side over fixtures. The real
 * version moves evaluation server-side next to the likes sampler and adds
 * extension push + Telegram delivery; this panel stays the in-app surface.
 */

import { feedMarkets, marketById, type FixtureMarket } from "./fixtures";

// --- rule model -------------------------------------------------------------

export interface RuleConditions {
  /** Like gap as a ratio: leader/trailer <= this ("neck and neck"). */
  gapRatioMax?: number;
  /** Like gap as a ratio: leader/trailer >= this ("leading 2:1"). */
  gapRatioMin?: number;
  /** Like gap in absolute likes: |a-b| <= this. */
  gapAbsMax?: number;
  /** Like count on the bigger side, above / below. */
  likesMin?: number;
  likesMax?: number;
  /** Total staked, above / below. */
  stakedMin?: number;
  stakedMax?: number;
  /** Money imbalance: bigger pot / smaller pot >= this. */
  imbalanceRatioMin?: number;
  /** Time remaining in minutes, below / above. */
  minsLeftMax?: number;
  minsLeftMin?: number;
  /** Either account is one of these handles (lowercase, no @). */
  watchlist?: string[];
  /** Market type. Absent = both. */
  pairType?: "reply" | "quote";
}

export interface ScannerRule {
  id: string;
  /** What the user typed, verbatim. */
  text: string;
  /** The parsed rule, human-readable — what they confirmed. */
  summary: string;
  conditions: RuleConditions;
  createdAtMs: number;
  /** Markets this rule has fired on (fire-once log + the match count). */
  matchedMarketIds: string[];
}

export interface ScannerAlert {
  id: string;
  ruleId: string;
  ruleSummary: string;
  marketId: string;
  handleA: string;
  handleB: string;
  stakedUsd: number;
  minsLeft: number;
  atMs: number;
}

export interface ChatMsg {
  who: "you" | "scanner";
  text: string;
}

export interface RuleDraft {
  text: string;
  summary: string;
  conditions: RuleConditions;
}

// --- parser -----------------------------------------------------------------

const num = (raw: string): number => {
  const cleaned = raw.replace(/[$,\s]/g, "").toLowerCase();
  if (cleaned.endsWith("k")) return parseFloat(cleaned) * 1_000;
  if (cleaned.endsWith("m")) return parseFloat(cleaned) * 1_000_000;
  return parseFloat(cleaned);
};

const NUM = "\\$?[\\d,.]+\\s?[km]?";

export type ParseResult =
  | { kind: "rule"; draft: RuleDraft }
  | { kind: "clarify"; question: string };

/**
 * Plain English -> conditions. Keyword grammar, deliberately forgiving:
 * the confirmation step catches misreads, and anything unparseable gets
 * ONE clarifying question, never a guess. (Real version: swap this for a
 * small-model extract behind the same ParseResult shape.)
 */
export function parseRule(input: string): ParseResult {
  const t = input.toLowerCase().trim();
  const c: RuleConditions = {};
  const parts: string[] = [];

  // watchlist: any @handles
  const handles = [...t.matchAll(/@([a-z0-9_]+)/g)].map((m) => m[1]!);
  if (handles.length > 0) {
    c.watchlist = handles;
    parts.push(`involving ${handles.map((h) => `@${h}`).join(" or ")}`);
  }

  // market type
  if (/\bquote|qt\b/.test(t) && !/\breply\b/.test(t)) {
    c.pairType = "quote";
    parts.push("quote tweets only");
  } else if (/\breply|replies\b/.test(t) && !/\bquote|qt\b/.test(t)) {
    c.pairType = "reply";
    parts.push("replies only");
  }

  // like gap, ratio or absolute
  const withinPct = t.match(new RegExp(`within\\s+(${NUM})\\s*(?:%|percent)`));
  const withinLikes = t.match(new RegExp(`within\\s+(${NUM})\\s+likes`));
  const leadRatio = t.match(new RegExp(`(?:leading|ahead|up)\\s+(?:by\\s+)?(${NUM})\\s*(?::|to)\\s*1`));
  if (withinPct) {
    c.gapRatioMax = 1 + num(withinPct[1]!) / 100;
    parts.push(`like gap within ${num(withinPct[1]!)}%`);
  } else if (withinLikes) {
    c.gapAbsMax = num(withinLikes[1]!);
    parts.push(`like gap within ${num(withinLikes[1]!).toLocaleString("en-US")} likes`);
  } else if (leadRatio) {
    c.gapRatioMin = num(leadRatio[1]!);
    parts.push(`one side leading ${num(leadRatio[1]!)}:1 or more`);
  } else if (/neck and neck|dead even|tight|close market|close race|too close/.test(t)) {
    c.gapRatioMax = 1.15;
    parts.push("like gap within 15%");
  }

  // like counts (skip matches that were about staked $)
  const likesOver = t.match(new RegExp(`(?:over|above|more than|at least)\\s+(${NUM})\\s+likes`));
  const likesUnder = t.match(new RegExp(`(?:under|below|less than)\\s+(${NUM})\\s+likes`));
  if (likesOver) {
    c.likesMin = num(likesOver[1]!);
    parts.push(`over ${num(likesOver[1]!).toLocaleString("en-US")} likes`);
  }
  if (likesUnder) {
    c.likesMax = num(likesUnder[1]!);
    parts.push(`under ${num(likesUnder[1]!).toLocaleString("en-US")} likes`);
  }

  // staked (needs a $ or the word staked/pot-adjacent phrasing)
  const stakedOver = t.match(new RegExp(`(?:over|above|more than|at least)\\s+\\$([\\d,.]+\\s?[km]?)(?!\\s*likes)`)) ??
    t.match(new RegExp(`staked?\\s+(?:over|above|more than)\\s+(${NUM})`));
  const stakedUnder = t.match(new RegExp(`(?:under|below|less than)\\s+\\$([\\d,.]+\\s?[km]?)(?!\\s*likes)`)) ??
    t.match(new RegExp(`staked?\\s+(?:under|below|less than)\\s+(${NUM})`));
  if (stakedOver) {
    c.stakedMin = num(stakedOver[1]!);
    parts.push(`over $${num(stakedOver[1]!).toLocaleString("en-US")} staked`);
  }
  if (stakedUnder) {
    c.stakedMax = num(stakedUnder[1]!);
    parts.push(`under $${num(stakedUnder[1]!).toLocaleString("en-US")} staked`);
  }

  // money imbalance
  const imbalanceX = t.match(new RegExp(`money\\s+(?:imbalance|lopsided)?\\s*(${NUM})\\s*x`));
  if (imbalanceX) {
    c.imbalanceRatioMin = num(imbalanceX[1]!);
    parts.push(`money ${num(imbalanceX[1]!)}x lopsided`);
  } else if (/barely funded|one.?sided money|lopsided|imbalance|nobody on one side|empty side/.test(t)) {
    c.imbalanceRatioMin = 5;
    parts.push("money 5x lopsided or worse");
  }

  // time remaining
  const underTime = t.match(new RegExp(`(?:under|less than|within)\\s+(?:an?\\s+)?(${NUM})?\\s*(hour|hr|minute|min)`));
  const overTime = t.match(new RegExp(`(?:over|more than|at least)\\s+(?:an?\\s+)?(${NUM})?\\s*(hour|hr|minute|min)`));
  const timeMins = (m: RegExpMatchArray) => {
    const n = m[1] ? num(m[1]) : 1;
    return /hour|hr/.test(m[2]!) ? n * 60 : n;
  };
  if (underTime && /clos|end|settl|left|remain|expir|final/.test(t)) {
    c.minsLeftMax = timeMins(underTime);
    parts.push(`closing in under ${c.minsLeftMax >= 60 ? `${c.minsLeftMax / 60}h` : `${c.minsLeftMax}m`}`);
  } else if (overTime && /left|remain|clos|end/.test(t)) {
    c.minsLeftMin = timeMins(overTime);
    parts.push(`more than ${c.minsLeftMin >= 60 ? `${c.minsLeftMin / 60}h` : `${c.minsLeftMin}m`} left`);
  }

  if (parts.length === 0) {
    // bare number with no unit is the classic ambiguous case
    if (/[\d]/.test(t)) {
      return {
        kind: "clarify",
        question: "is that number likes, dollars staked, or time left? say it with a unit, like \"over 5k likes\" or \"under $100 staked\" or \"closing in under an hour\".",
      };
    }
    return {
      kind: "clarify",
      question: "i can watch the like gap, like counts, money staked, money imbalance, time left, specific @handles, or replies vs quote tweets. what should trigger this one?",
    };
  }

  return {
    kind: "rule",
    draft: { text: input.trim(), summary: parts.join(" · "), conditions: c },
  };
}

// --- evaluator --------------------------------------------------------------

export function marketMatches(m: FixtureMarket, c: RuleConditions, nowMs: number): boolean {
  const a = m.data.a;
  const b = m.data.b;
  const leader = Math.max(a.likes, b.likes);
  const trailer = Math.max(1, Math.min(a.likes, b.likes));
  const gapRatio = leader / trailer;
  const staked = a.potUsd + b.potUsd;
  const bigPot = Math.max(a.potUsd, b.potUsd);
  const smallPot = Math.max(1, Math.min(a.potUsd, b.potUsd));
  const minsLeft = Math.max(0, (m.data.settlesAtMs - nowMs) / 60_000);

  if (c.gapRatioMax !== undefined && gapRatio > c.gapRatioMax) return false;
  if (c.gapRatioMin !== undefined && gapRatio < c.gapRatioMin) return false;
  if (c.gapAbsMax !== undefined && Math.abs(a.likes - b.likes) > c.gapAbsMax) return false;
  if (c.likesMin !== undefined && leader < c.likesMin) return false;
  if (c.likesMax !== undefined && leader > c.likesMax) return false;
  if (c.stakedMin !== undefined && staked < c.stakedMin) return false;
  if (c.stakedMax !== undefined && staked > c.stakedMax) return false;
  if (c.imbalanceRatioMin !== undefined && bigPot / smallPot < c.imbalanceRatioMin) return false;
  if (c.minsLeftMax !== undefined && minsLeft > c.minsLeftMax) return false;
  if (c.minsLeftMin !== undefined && minsLeft < c.minsLeftMin) return false;
  if (c.watchlist && !c.watchlist.some((h) => h === a.handle.toLowerCase() || h === b.handle.toLowerCase()))
    return false;
  if (c.pairType && m.pairType !== c.pairType) return false;
  return true;
}

// --- module store (survives navigation; persists what matters) --------------

const LS_KEY = "ratio-scanner-v1";
const OPEN_KEY = "ratio-scanner-open";
const EVENT = "ratio-scanner";

interface Persisted {
  rules: ScannerRule[];
  alerts: ScannerAlert[];
  /** Instrumentation: whether an auto-trading version is worth building
   * lives or dies on alertBets vs alertsFired. */
  metrics: { rulesCreated: number; alertsFired: number; alertBets: number };
  /** marketId of the last alert clicked, for bet attribution. */
  lastAlertClick?: { marketId: string; atMs: number };
}

const state: {
  loaded: boolean;
  transcript: ChatMsg[];
  draft: RuleDraft | null;
} & Persisted = {
  loaded: false,
  transcript: [],
  draft: null,
  rules: [],
  alerts: [],
  metrics: { rulesCreated: 0, alertsFired: 0, alertBets: 0 },
};

const emit = () => window.dispatchEvent(new Event(EVENT));

const load = () => {
  if (state.loaded || typeof window === "undefined") return;
  state.loaded = true;
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Persisted;
      state.rules = p.rules ?? [];
      state.alerts = p.alerts ?? [];
      state.metrics = p.metrics ?? state.metrics;
      state.lastAlertClick = p.lastAlertClick;
    }
  } catch {
    // corrupted store: start clean rather than crash the panel
  }
};

const save = () => {
  localStorage.setItem(
    LS_KEY,
    JSON.stringify({
      rules: state.rules,
      alerts: state.alerts,
      metrics: state.metrics,
      lastAlertClick: state.lastAlertClick,
    } satisfies Persisted),
  );
};

export const scannerStore = {
  load,
  event: EVENT,
  get: () => state,

  isOpen: (): boolean => localStorage.getItem(OPEN_KEY) !== "0",
  setOpen: (open: boolean) => {
    localStorage.setItem(OPEN_KEY, open ? "1" : "0");
    emit();
  },

  send(text: string) {
    load();
    state.transcript.push({ who: "you", text });
    const parsed = parseRule(text);
    if (parsed.kind === "clarify") {
      state.draft = null;
      state.transcript.push({ who: "scanner", text: parsed.question });
    } else {
      state.draft = parsed.draft;
      state.transcript.push({ who: "scanner", text: `watching for: ${parsed.draft.summary}. save it?` });
    }
    emit();
  },

  saveDraft(): ScannerRule | null {
    load();
    if (!state.draft) return null;
    const rule: ScannerRule = {
      id: `r${Date.now().toString(36)}`,
      text: state.draft.text,
      summary: state.draft.summary,
      conditions: state.draft.conditions,
      createdAtMs: Date.now(),
      matchedMarketIds: [],
    };
    state.rules.push(rule);
    state.metrics.rulesCreated += 1;
    state.draft = null;
    state.transcript.push({ who: "scanner", text: "saved. you'll hear about it here the moment a market matches." });
    save();
    emit();
    this.evaluate();
    return rule;
  },

  discardDraft() {
    state.draft = null;
    state.transcript.push({ who: "scanner", text: "dropped. describe it differently and we go again." });
    emit();
  },

  deleteRule(id: string) {
    load();
    state.rules = state.rules.filter((r) => r.id !== id);
    save();
    emit();
  },

  /** Runs on the likes-sampler cadence. Fire-once per rule per market. */
  evaluate() {
    load();
    const nowMs = Date.now();
    let fired = false;
    for (const rule of state.rules) {
      for (const m of feedMarkets()) {
        if (rule.matchedMarketIds.includes(m.data.marketId)) continue;
        if (!marketMatches(m, rule.conditions, nowMs)) continue;
        rule.matchedMarketIds.push(m.data.marketId);
        state.alerts.unshift({
          id: `a${nowMs.toString(36)}${state.alerts.length}`,
          ruleId: rule.id,
          ruleSummary: rule.summary,
          marketId: m.data.marketId,
          handleA: m.data.a.handle,
          handleB: m.data.b.handle,
          stakedUsd: m.data.a.potUsd + m.data.b.potUsd,
          minsLeft: Math.max(0, Math.round((m.data.settlesAtMs - nowMs) / 60_000)),
          atMs: nowMs,
        });
        state.metrics.alertsFired += 1;
        fired = true;
      }
    }
    state.alerts = state.alerts.slice(0, 20);
    if (fired) {
      save();
      emit();
    }
  },

  dismissAlert(id: string) {
    load();
    state.alerts = state.alerts.filter((a) => a.id !== id);
    save();
    emit();
  },

  /** Attribution, half one: the user clicked through from an alert. */
  noteAlertClick(marketId: string) {
    load();
    state.lastAlertClick = { marketId, atMs: Date.now() };
    save();
  },

  /** Attribution, half two: called by placeBet. A bet within 30 minutes
   * of clicking an alert for the same market counts as alert-led. */
  creditBetFromAlert(marketId: string) {
    load();
    const c = state.lastAlertClick;
    if (c && c.marketId === marketId && Date.now() - c.atMs < 30 * 60_000) {
      state.metrics.alertBets += 1;
      state.lastAlertClick = undefined;
      save();
    }
  },
};

/** Preset prompts — the empty state is suggestions, never a blank box. */
export const SCANNER_PRESETS = [
  "close markets over 5k likes",
  "one side barely funded",
  "closing in under an hour",
] as const;

export { marketById };
