"use client";

/**
 * Mobile navigation: the sidebar hides under 900px, so a fixed bottom
 * bar carries the essentials — home, leaderboard, profile. Same
 * point-of-action auth gate as the sidebar: profile prompts login when
 * logged out. Desktop never sees this (display gated in CSS).
 */
import Link from "next/link";
import { usePathname } from "next/navigation";

import { useAuth } from "../lib/auth";

export function MobileNav() {
  const { viewer, login } = useAuth();
  const pathname = usePathname();

  const item = (href: string, label: string) => (
    <Link
      className={pathname === href ? "mnav-item mnav-item-on" : "mnav-item"}
      href={href}
    >
      {label}
    </Link>
  );

  return (
    <nav className="mnav">
      {item("/", "home")}
      {item("/leaderboard", "leaderboard")}
      {viewer ? (
        item(`/${viewer}`, "profile")
      ) : (
        <button className="mnav-item" onClick={login}>
          profile
        </button>
      )}
    </nav>
  );
}
