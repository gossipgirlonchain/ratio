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

import { useAuth } from "../lib/auth";

const KEY = "ratio-sidebar-collapsed";

export function Sidebar() {
  const { viewer, login } = useAuth();
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => setCollapsed(localStorage.getItem(KEY) === "1"), []);
  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem(KEY, next ? "1" : "0");
  };

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
          <div className="sidebar-bottom">
            <Link className="sidebar-cta" href="/extension">
              get the extension
            </Link>
            {item("/how", "how it works")}
            {item("/terms", "terms")}
            {item("/privacy", "privacy")}
          </div>
        </>
      )}
    </aside>
  );
}
