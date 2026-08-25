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
            <button className="side-item" onClick={flipTheme}>
              {theme === "dark" ? "light mode" : "dark mode"}
            </button>
            <button
              className="side-item"
              onClick={() => {
                setSoundEnabled(!sound);
                setSound(!sound);
              }}
            >
              sound: {sound ? "on" : "off"}
            </button>
            {item("/how", "how it works")}
            {item("/terms", "terms")}
            {item("/privacy", "privacy")}
          </div>
        </>
      )}
    </aside>
  );
}
