"use client";

/**
 * Persistent left sidebar: logo, nav, and lower down the secondary links.
 * A footer under an infinite feed is unreachable, so everything lives
 * here. "get the extension" is the persistent CTA. Collapsible, and the
 * collapsed state sticks.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { LIKES_SAMPLE_INTERVAL_MS } from "@ratio/config";

import { useAuth } from "../lib/auth";
import { XLogo } from "@ratio/ui";

import { likeGapSince, openPositionsFor, useLive } from "../lib/live";
import { setSoundEnabled, soundEnabled } from "../lib/sound";
import { usePendingBets } from "../lib/trade";

const KEY = "ratio-sidebar-collapsed";

/**
 * Live positions, on every page. Sells are off, so there is nothing to DO
 * with a position — but there is something to WATCH: the like gap. Money
 * cannot move until settlement; the likes move all 24 hours. Refreshes on
 * the likes-sampler cadence (that is when the number can change) and
 * instantly when an optimistic placement lands.
 */
function SidePositions({ viewer }: { viewer: string | null }) {
  const world = useLive();
  const pending = usePendingBets();
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), LIKES_SAMPLE_INTERVAL_MS);
    return () => clearInterval(t);
  }, []);
  if (!viewer) return null;
  const positions = openPositionsFor(world, viewer);
  const confirming = pending.filter((b) => b.state === "confirming").length;
  if (positions.length === 0 && confirming === 0) return null;
  // one block per MARKET: betting both sides is one battle, not two rows
  const byMarket = new Map<string, typeof positions>();
  for (const p of positions) {
    byMarket.set(p.marketId, [...(byMarket.get(p.marketId) ?? []), p]);
  }
  return (
    <div className="side-positions">
      <div className="side-positions-head">
        positions ({byMarket.size}{confirming > 0 ? ` +${confirming}` : ""})
      </div>
      {[...byMarket.entries()].map(([marketId, ps]) => (
        <Link className="side-market" href={`/m/${marketId}`} key={marketId}>
          {ps.map((p) => {
            const gap = likeGapSince(world, p);
            return (
              <span className="side-pos" key={p.side}>
                <span className="side-pos-handle">@{p.sideHandle}</span>
                <span className="side-pos-stake">${p.netStakedUsd.toLocaleString("en-US")}</span>
                <span className={gap >= 0 ? "side-pos-gap" : "side-pos-gap side-pos-gap-down"}>
                  {gap >= 0 ? "▲" : "▼"} {Math.abs(gap).toLocaleString("en-US")}
                </span>
              </span>
            );
          })}
        </Link>
      ))}
    </div>
  );
}

export function Sidebar() {
  const { viewer, login } = useAuth();
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [sound, setSound] = useState(false);
  useEffect(() => {
    setCollapsed(localStorage.getItem(KEY) === "1");
    setTheme((localStorage.getItem("ratio-theme") as "dark" | "light") || "dark");
    setSound(soundEnabled());
  }, []);
  const flipTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    localStorage.setItem("ratio-theme", next);
    document.documentElement.dataset.theme = next;
  };
  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem(KEY, next ? "1" : "0");
  };

  // the gate is pre-wall: no chrome leaks through it
  if (pathname === "/gate") return null;

  const item = (href: string, label: string) => (
    <Link className={pathname === href ? "side-item side-item-on" : "side-item"} href={href}>
      {label}
    </Link>
  );

  return (
    <aside className={collapsed ? "sidebar sidebar-collapsed" : "sidebar"}>
      <div className="sidebar-top">
        <Link className="nav-home" href="/">
          {collapsed ? "r" : "ratio"}
        </Link>
        <button className="sidebar-toggle" onClick={toggle} aria-label="collapse sidebar">
          {collapsed ? "»" : "«"}
        </button>
      </div>
      {!collapsed && (
        <>
          <nav className="side-nav">
            {item("/", "home")}
            {item("/leaderboard", "leaderboard")}
            {viewer ? (
              item(`/${viewer}`, "profile")
            ) : (
              // Point-of-action gate: profile exists in the nav either way.
              <button className="side-item" onClick={login}>
                profile
              </button>
            )}
          </nav>
          <SidePositions viewer={viewer} />
          <div className="sidebar-bottom">
            <Link className="sidebar-cta" href="/extension">
              get the extension
            </Link>
            <div className="side-icon-row">
              <a
                className="side-icon"
                href="https://x.com/ratiowtf"
                target="_blank"
                rel="noreferrer"
                aria-label="@ratiowtf on x"
                title="@ratiowtf on x"
              >
                <XLogo size={15} />
              </a>
              <button
                className="side-icon"
                onClick={flipTheme}
                aria-label={theme === "dark" ? "light mode" : "dark mode"}
                title={theme === "dark" ? "light mode" : "dark mode"}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
                  {theme === "dark" ? (
                    <>
                      <circle cx="12" cy="12" r="4.4" fill="currentColor" stroke="none" />
                      <path d="M12 2.6v2.4M12 19v2.4M2.6 12h2.4M19 12h2.4M5 5l1.7 1.7M17.3 17.3 19 19M19 5l-1.7 1.7M6.7 17.3 5 19" />
                    </>
                  ) : (
                    <path d="M20.4 14.2A8.4 8.4 0 0 1 9.8 3.6a8.4 8.4 0 1 0 10.6 10.6z" fill="currentColor" stroke="none" />
                  )}
                </svg>
              </button>
              <button
                className="side-icon"
                onClick={() => {
                  setSoundEnabled(!sound);
                  setSound(!sound);
                }}
                aria-label={sound ? "sound off" : "sound on"}
                title={sound ? "sound on" : "sound off"}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M4 9v6h4l5 4.5v-15L8 9z" />
                  {sound ? (
                    <path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  ) : (
                    <path d="M16 9.5 21 14.5M21 9.5 16 14.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  )}
                </svg>
              </button>
            </div>
            {item("/how", "how it works")}
            <div className="side-legal">
              <Link href="/terms">terms</Link>
              <span aria-hidden="true">·</span>
              <Link href="/privacy">privacy</Link>
            </div>
          </div>
        </>
      )}
    </aside>
  );
}
