"use client";

/**
 * The scanner panel: docked to the rail column's edge on every page,
 * below whatever the page's rail holds. Builder AND manager: the chat
 * writes rules, the rules list shows match counts, and alerts land here
 * as they fire — each leading with the market and a direct way to bet.
 *
 * State lives in scannerStore (module + localStorage), so navigation
 * never loses the conversation. Collapsible; remembers whether it's open.
 * Logged out: presets and chat work, SAVING prompts login (point of
 * action, like everywhere else).
 */
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { LIKES_SAMPLE_INTERVAL_MS } from "@ratio/config";

import { useAuth } from "../lib/auth";
import { SCANNER_PRESETS, scannerStore } from "../lib/scanner";
import { useMounted } from "../lib/useMounted";

const fmtUsd = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
const fmtLeft = (mins: number) =>
  mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`;

export function ScannerPanel() {
  const mounted = useMounted();
  const { viewer, login } = useAuth();
  const [, bump] = useState(0);
  const [input, setInput] = useState("");
  const [open, setOpen] = useState(true);
  const logRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  });

  if (!mounted) return null;
  const { transcript, draft, rules, alerts } = scannerStore.get();

  const send = (text: string) => {
    if (!text.trim()) return;
    scannerStore.send(text);
    setInput("");
  };

  const saveDraft = () => {
    if (!viewer) {
      login();
      return;
    }
    scannerStore.saveDraft();
  };

  if (!open) {
    return (
      <button className="scanner scanner-closed" onClick={() => scannerStore.setOpen(true)}>
        scanner{rules.length > 0 ? ` (${rules.length})` : ""}
        {alerts.length > 0 && <span className="scanner-dot" />}
      </button>
    );
  }

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

      <div className="scanner-log" ref={logRef}>
        {transcript.length === 0 && (
          <p className="scanner-hello">
            describe what to watch for, in plain english. i turn it into a
            standing rule and ping you here when a live market matches.
          </p>
        )}
        {transcript.map((m, i) => (
          <p key={i} className={m.who === "you" ? "scanner-msg scanner-msg-you" : "scanner-msg"}>
            {m.text}
          </p>
        ))}
        {draft && (
          <div className="scanner-confirm">
            <button className="scanner-save" onClick={saveDraft}>
              {viewer ? "save rule" : "log in to save"}
            </button>
            <button className="scanner-discard" onClick={() => scannerStore.discardDraft()}>
              discard
            </button>
          </div>
        )}
      </div>

      {rules.length === 0 && !draft && (
        <div className="scanner-presets">
          {SCANNER_PRESETS.map((p) => (
            <button key={p} className="scanner-preset" onClick={() => send(p)}>
              {p}
            </button>
          ))}
        </div>
      )}

      <form
        className="scanner-input-row"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <input
          className="scanner-input"
          placeholder="tell me when…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        <button className="scanner-send" type="submit" disabled={!input.trim()}>
          →
        </button>
      </form>
    </aside>
  );
}
