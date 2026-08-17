"use client";

/**
 * Market scanner (docs/scanner-spec.md, pulled forward 2026-08-13).
 * Alerts only — NO auto-execution, ever, without its own workstream.
 *
 * Rules are built with KNOBS — explicit controls per condition, nothing
 * qualitative (winny 2026-08-14, reversing the chat design): every
 * condition is a mode + number the user sets directly. Rules evaluate on
 * the likes-sampler cadence (that is when the data changes) and fire
 * ONCE per rule per market — the fired log is permanent, no repeats.
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

// --- summary: the saved rule line, generated from the knobs ----------------

const fmtN = (n: number) => n.toLocaleString("en-US");

export function buildSummary(c: RuleConditions): string {
  const parts: string[] = [];
  if (c.watchlist?.length) parts.push(`involving ${c.watchlist.map((h) => `@${h}`).join(" or ")}`);
  if (c.pairType) parts.push(c.pairType === "quote" ? "quote tweets only" : "replies only");
  if (c.gapRatioMax !== undefined) parts.push(`like gap within ${Math.round((c.gapRatioMax - 1) * 100)}%`);
  if (c.gapAbsMax !== undefined) parts.push(`like gap within ${fmtN(c.gapAbsMax)} likes`);
  if (c.gapRatioMin !== undefined) parts.push(`one side leading ${c.gapRatioMin}:1 or more`);
  if (c.likesMin !== undefined) parts.push(`over ${fmtN(c.likesMin)} likes`);
  if (c.likesMax !== undefined) parts.push(`under ${fmtN(c.likesMax)} likes`);
  if (c.stakedMin !== undefined) parts.push(`over $${fmtN(c.stakedMin)} staked`);
  if (c.stakedMax !== undefined) parts.push(`under $${fmtN(c.stakedMax)} staked`);
  if (c.imbalanceRatioMin !== undefined) parts.push(`money ${c.imbalanceRatioMin}x lopsided`);
  if (c.minsLeftMax !== undefined)
    parts.push(`closing in under ${c.minsLeftMax >= 60 ? `${c.minsLeftMax / 60}h` : `${c.minsLeftMax}m`}`);
  if (c.minsLeftMin !== undefined)
    parts.push(`more than ${c.minsLeftMin >= 60 ? `${c.minsLeftMin / 60}h` : `${c.minsLeftMin}m`} left`);
  return parts.join(" \u00b7 ");
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
} & Persisted = {
  loaded: false,
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

  /** Save a knob-built rule. The summary is generated, never typed. */
  saveRule(conditions: RuleConditions): ScannerRule {
    load();
    const rule: ScannerRule = {
      id: `r${Date.now().toString(36)}`,
      text: "",
      summary: buildSummary(conditions),
      conditions,
      createdAtMs: Date.now(),
      matchedMarketIds: [],
    };
    state.rules.push(rule);
    state.metrics.rulesCreated += 1;
    save();
    emit();
    this.evaluate();
    return rule;
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

/** Presets: concrete knob settings — one tap fills the controls, the
 * user still reviews and saves. Never a blank builder. */
export const SCANNER_PRESETS: Array<{ label: string; conditions: RuleConditions }> = [
  { label: "close markets over 5k likes", conditions: { gapRatioMax: 1.15, likesMin: 5_000 } },
  { label: "one side barely funded", conditions: { imbalanceRatioMin: 5 } },
  { label: "closing in under an hour", conditions: { minsLeftMax: 60 } },
];

export { marketById };
