"use client";

/**
 * The scanner panel: docked to the rail column's edge on every page.
 * Builder AND manager: KNOBS build rules (explicit mode + number per
 * condition, nothing qualitative), the rules list shows match counts,
 * and alerts land here as they fire — each leading with the market and
 * a direct way to bet.
 *
 * The knob draft lives at module level so navigation never resets it.
 * Collapsible; remembers whether it's open. Logged out: knobs work,
 * SAVING prompts login (point of action, like everywhere else).
 */
import Link from "next/link";
import { useEffect, useState } from "react";

import { LIKES_SAMPLE_INTERVAL_MS } from "@ratio/config";

import { useAuth } from "../lib/auth";
import {
  buildSummary,
  SCANNER_PRESETS,
  scannerStore,
  type RuleConditions,
} from "../lib/scanner";
import { useMounted } from "../lib/useMounted";

const fmtUsd = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
const fmtLeft = (mins: number) =>
  mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`;

// --- knob state (module-level: survives navigation) -------------------------

interface Knobs {
  gapMode: "any" | "withinPct" | "withinLikes" | "leadRatio";
  gapVal: string;
  likesMode: "any" | "over" | "under";
  likesVal: string;
  stakedMode: "any" | "over" | "under";
  stakedVal: string;
  imbalanceMode: "any" | "atLeast";
  imbalanceVal: string;
  timeMode: "any" | "under" | "over";
  timeVal: string;
  timeUnit: "h" | "m";
  watchlist: string;
  pairType: "both" | "reply" | "quote";
}

const BLANK: Knobs = {
  gapMode: "any",
  gapVal: "10",
  likesMode: "any",
  likesVal: "5000",
  stakedMode: "any",
  stakedVal: "500",
  imbalanceMode: "any",
  imbalanceVal: "5",
  timeMode: "any",
  timeVal: "1",
  timeUnit: "h",
  watchlist: "",
  pairType: "both",
};

let knobDraft: Knobs = { ...BLANK };
/** Builder visibility, module-level. null = auto: open only while the
 * user has no rules. After a save it minimises — the panel's job
 * becomes showing results, not the form. */
let builderOpen: boolean | null = null;

const num = (raw: string): number | undefined => {
  const n = parseFloat(raw.replace(/[$,\s]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

function knobsToConditions(k: Knobs): RuleConditions {
  const c: RuleConditions = {};
  const gapN = num(k.gapVal);
  if (k.gapMode === "withinPct" && gapN) c.gapRatioMax = 1 + gapN / 100;
  if (k.gapMode === "withinLikes" && gapN) c.gapAbsMax = gapN;
  if (k.gapMode === "leadRatio" && gapN) c.gapRatioMin = gapN;
  const likesN = num(k.likesVal);
  if (k.likesMode === "over" && likesN) c.likesMin = likesN;
  if (k.likesMode === "under" && likesN) c.likesMax = likesN;
  const stakedN = num(k.stakedVal);
  if (k.stakedMode === "over" && stakedN) c.stakedMin = stakedN;
  if (k.stakedMode === "under" && stakedN) c.stakedMax = stakedN;
  const imbN = num(k.imbalanceVal);
  if (k.imbalanceMode === "atLeast" && imbN) c.imbalanceRatioMin = imbN;
  const timeN = num(k.timeVal);
  if (k.timeMode !== "any" && timeN) {
    const mins = k.timeUnit === "h" ? timeN * 60 : timeN;
    if (k.timeMode === "under") c.minsLeftMax = mins;
    else c.minsLeftMin = mins;
  }
  const handles = k.watchlist
    .toLowerCase()
    .split(/[\s,]+/)
    .map((h) => h.replace(/^@/, ""))
    .filter(Boolean);
  if (handles.length > 0) c.watchlist = handles;
  if (k.pairType !== "both") c.pairType = k.pairType;
  return c;
}

/** Presets prefill the knobs; the user still reviews and saves. */
function conditionsToKnobs(c: RuleConditions): Knobs {
  const k: Knobs = { ...BLANK };
  if (c.gapRatioMax !== undefined) {
    k.gapMode = "withinPct";
    k.gapVal = String(Math.round((c.gapRatioMax - 1) * 100));
  }
  if (c.gapAbsMax !== undefined) {
    k.gapMode = "withinLikes";
    k.gapVal = String(c.gapAbsMax);
  }
  if (c.gapRatioMin !== undefined) {
    k.gapMode = "leadRatio";
    k.gapVal = String(c.gapRatioMin);
  }
  if (c.likesMin !== undefined) {
    k.likesMode = "over";
    k.likesVal = String(c.likesMin);
  }
  if (c.likesMax !== undefined) {
    k.likesMode = "under";
    k.likesVal = String(c.likesMax);
  }
  if (c.stakedMin !== undefined) {
    k.stakedMode = "over";
    k.stakedVal = String(c.stakedMin);
  }
  if (c.stakedMax !== undefined) {
    k.stakedMode = "under";
    k.stakedVal = String(c.stakedMax);
  }
  if (c.imbalanceRatioMin !== undefined) {
    k.imbalanceMode = "atLeast";
    k.imbalanceVal = String(c.imbalanceRatioMin);
  }
  if (c.minsLeftMax !== undefined) {
    k.timeMode = "under";
    k.timeUnit = c.minsLeftMax >= 60 ? "h" : "m";
    k.timeVal = String(c.minsLeftMax >= 60 ? c.minsLeftMax / 60 : c.minsLeftMax);
  }
  if (c.minsLeftMin !== undefined) {
    k.timeMode = "over";
    k.timeUnit = c.minsLeftMin >= 60 ? "h" : "m";
    k.timeVal = String(c.minsLeftMin >= 60 ? c.minsLeftMin / 60 : c.minsLeftMin);
  }
  if (c.watchlist?.length) k.watchlist = c.watchlist.map((h) => `@${h}`).join(" ");
  if (c.pairType) k.pairType = c.pairType;
  return k;
}

// --- component --------------------------------------------------------------

export function ScannerPanel() {
  const mounted = useMounted();
  const { viewer, login } = useAuth();
  const [, bump] = useState(0);
  const [open, setOpen] = useState(true);
  const [, syncBuilder] = useState(0);
  const [knobs, setKnobsState] = useState<Knobs>(knobDraft);
  const setKnobs = (patch: Partial<Knobs>) => {
    knobDraft = { ...knobDraft, ...patch };
    setKnobsState(knobDraft);
  };

  useEffect(() => {
    scannerStore.load();
    setOpen(scannerStore.isOpen());
    const on = () => {
      setOpen(scannerStore.isOpen());
      bump((n) => n + 1);
    };
    window.addEventListener(scannerStore.event, on);
    // evaluate now, then on the likes-sampler cadence — that is when the
    // underlying numbers can change, so more often would be theatre.
    scannerStore.evaluate();
    const t = setInterval(() => scannerStore.evaluate(), LIKES_SAMPLE_INTERVAL_MS);
    return () => {
      window.removeEventListener(scannerStore.event, on);
      clearInterval(t);
    };
  }, []);

  if (!mounted) return null;
  const { rules, alerts } = scannerStore.get();
  const conditions = knobsToConditions(knobs);
  const summary = buildSummary(conditions);
  const hasConditions = Object.keys(conditions).length > 0;

  const saveRule = () => {
    if (!hasConditions) return;
    if (!viewer) {
      login();
      return;
    }
    scannerStore.saveRule(conditions);
    knobDraft = { ...BLANK };
    setKnobsState(knobDraft);
    // minimise the builder: from here the panel is about results
    builderOpen = false;
    syncBuilder((n) => n + 1);
  };
  const showBuilder = builderOpen ?? scannerStore.get().rules.length === 0;

  if (!open) {
    return (
      <button className="scanner scanner-closed" onClick={() => scannerStore.setOpen(true)}>
        scanner{rules.length > 0 ? ` (${rules.length})` : ""}
        {alerts.length > 0 && <span className="scanner-dot" />}
      </button>
    );
  }

  const sel = (
    value: string,
    onChange: (v: string) => void,
    options: Array<[string, string]>,
  ) => (
    <select className="scanner-sel" value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map(([v, label]) => (
        <option key={v} value={v}>
          {label}
        </option>
      ))}
    </select>
  );

  const numInput = (value: string, onChange: (v: string) => void, disabled: boolean, width = 62) => (
    <input
      className="scanner-num"
      style={{ width }}
      inputMode="decimal"
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    />
  );

  return (
    <aside className="scanner">
      <header className="scanner-head">
        <span>
          scanner
          {alerts.length > 0 && <span className="scanner-dot" />}
        </span>
        <button className="scanner-collapse" onClick={() => scannerStore.setOpen(false)} aria-label="collapse scanner">
          ▾
        </button>
      </header>

      {alerts.length > 0 && (
        <div className="scanner-alerts">
          {alerts.map((a) => (
            <div className="scanner-alert" key={a.id}>
              <Link
                href={`/m/${a.marketId}`}
                className="scanner-alert-market"
                onClick={() => scannerStore.noteAlertClick(a.marketId)}
              >
                @{a.handleA} vs @{a.handleB}
              </Link>
              <span className="scanner-alert-meta">
                {fmtUsd(a.stakedUsd)} staked · {fmtLeft(a.minsLeft)} left
              </span>
              <span className="scanner-alert-rule">{a.ruleSummary}</span>
              <span className="scanner-alert-actions">
                <Link
                  href={`/m/${a.marketId}`}
                  className="scanner-bet"
                  onClick={() => scannerStore.noteAlertClick(a.marketId)}
                >
                  bet
                </Link>
                <button className="scanner-x" onClick={() => scannerStore.dismissAlert(a.id)} aria-label="dismiss alert">
                  ×
                </button>
              </span>
            </div>
          ))}
        </div>
      )}

      {rules.length > 0 && (
        <div className="scanner-rules">
          {rules.map((r) => (
            <div className="scanner-rule" key={r.id}>
              <span className="scanner-rule-sum">{r.summary}</span>
              <span className="scanner-rule-meta">
                {r.matchedMarketIds.length} match{r.matchedMarketIds.length === 1 ? "" : "es"}
                <button className="scanner-x" onClick={() => scannerStore.deleteRule(r.id)} aria-label="delete rule">
                  ×
                </button>
              </span>
            </div>
          ))}
        </div>
      )}

      {/* the toggle works BOTH ways: open to build, hide to focus on
          results — saving is not the only way out */}
      <button
        className="scanner-new-rule"
        onClick={() => {
          builderOpen = !showBuilder;
          syncBuilder((n) => n + 1);
        }}
      >
        {showBuilder ? "hide rule builder" : "+ new rule"}
      </button>

      {showBuilder && (
      <>
      <div className="scanner-knobs">
        <div className="scanner-knob">
          <span className="scanner-knob-label">like gap</span>
          {sel(knobs.gapMode, (v) => setKnobs({ gapMode: v as Knobs["gapMode"] }), [
            ["any", "any"],
            ["withinPct", "within %"],
            ["withinLikes", "within likes"],
            ["leadRatio", "leader ≥ x:1"],
          ])}
          {numInput(knobs.gapVal, (v) => setKnobs({ gapVal: v }), knobs.gapMode === "any")}
        </div>
        <div className="scanner-knob">
          <span className="scanner-knob-label">likes</span>
          {sel(knobs.likesMode, (v) => setKnobs({ likesMode: v as Knobs["likesMode"] }), [
            ["any", "any"],
            ["over", "over"],
            ["under", "under"],
          ])}
          {numInput(knobs.likesVal, (v) => setKnobs({ likesVal: v }), knobs.likesMode === "any")}
        </div>
        <div className="scanner-knob">
          <span className="scanner-knob-label">staked $</span>
          {sel(knobs.stakedMode, (v) => setKnobs({ stakedMode: v as Knobs["stakedMode"] }), [
            ["any", "any"],
            ["over", "over"],
            ["under", "under"],
          ])}
          {numInput(knobs.stakedVal, (v) => setKnobs({ stakedVal: v }), knobs.stakedMode === "any")}
        </div>
        <div className="scanner-knob">
          <span className="scanner-knob-label">imbalance</span>
          {sel(knobs.imbalanceMode, (v) => setKnobs({ imbalanceMode: v as Knobs["imbalanceMode"] }), [
            ["any", "any"],
            ["atLeast", "≥ x times"],
          ])}
          {numInput(knobs.imbalanceVal, (v) => setKnobs({ imbalanceVal: v }), knobs.imbalanceMode === "any")}
        </div>
        <div className="scanner-knob">
          <span className="scanner-knob-label">time left</span>
          {sel(knobs.timeMode, (v) => setKnobs({ timeMode: v as Knobs["timeMode"] }), [
            ["any", "any"],
            ["under", "under"],
            ["over", "over"],
          ])}
          {numInput(knobs.timeVal, (v) => setKnobs({ timeVal: v }), knobs.timeMode === "any", 40)}
          {sel(knobs.timeUnit, (v) => setKnobs({ timeUnit: v as Knobs["timeUnit"] }), [
            ["h", "h"],
            ["m", "m"],
          ])}
        </div>
        <div className="scanner-knob">
          <span className="scanner-knob-label">handles</span>
          <input
            className="scanner-num scanner-handles"
            placeholder="@anyone"
            value={knobs.watchlist}
            onChange={(e) => setKnobs({ watchlist: e.target.value })}
          />
        </div>
        <div className="scanner-knob">
          <span className="scanner-knob-label">type</span>
          <div className="scanner-seg">
            {(["both", "reply", "quote"] as const).map((t) => (
              <button
                key={t}
                className={knobs.pairType === t ? "scanner-seg-btn scanner-seg-on" : "scanner-seg-btn"}
                onClick={() => setKnobs({ pairType: t })}
              >
                {t === "both" ? "both" : t === "reply" ? "replies" : "quotes"}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="scanner-footer">
        <span className="scanner-summary">{hasConditions ? summary : "set a condition above"}</span>
        <button className="scanner-save" disabled={!hasConditions} onClick={saveRule}>
          {viewer ? "save rule" : "log in to save"}
        </button>
      </div>

      <div className="scanner-presets">
        {SCANNER_PRESETS.map((p) => (
          <button
            key={p.label}
            className="scanner-preset"
            onClick={() => {
              knobDraft = conditionsToKnobs(p.conditions);
              setKnobsState(knobDraft);
            }}
          >
            {p.label}
          </button>
        ))}
      </div>
      </>
      )}
    </aside>
  );
}
