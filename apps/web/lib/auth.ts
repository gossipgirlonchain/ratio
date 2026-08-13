"use client";

/**
 * Auth = Privy X OAuth, nothing else. Logged out is the default and every
 * page stays fully readable; actions (betting, claiming, depositing,
 * withdrawing) prompt login at the point of action, never before.
 *
 * `viewer` is the X handle (display + fixture lookups); `xUserId` is the
 * numeric X id — the durable key wallets and store records hang off
 * (handles are a display cache, they can change).
 */
import { usePrivy } from "@privy-io/react-auth";
import { useEffect, useState } from "react";

export function useAuth(): {
  viewer: string | null;
  xUserId: string | null;
  ready: boolean;
  login: () => void;
  logout: () => void;
} {
  const { ready, authenticated, user, login, logout } = usePrivy();
  const twitter = user?.twitter ?? null;
  // Dev-only demo viewer for fixture-world walkthroughs: set
  // localStorage["ratio-demo-viewer"]="bigaccount" and reload. Resolved
  // AFTER mount (localStorage in render = hydration mismatch); the branch
  // compiles out of production builds entirely.
  const [demo, setDemo] = useState<string | null>(null);
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") {
      setDemo(localStorage.getItem("ratio-demo-viewer"));
    }
  }, []);
  if (process.env.NODE_ENV !== "production" && demo) {
    return {
      viewer: demo,
      xUserId: `demo:${demo}`,
      ready: true,
      login: () => {},
      logout: () => {
        localStorage.removeItem("ratio-demo-viewer");
        window.location.reload();
      },
    };
  }
  return {
    viewer: authenticated && twitter ? (twitter.username ?? null) : null,
    xUserId: authenticated && twitter ? twitter.subject : null,
    ready,
    login,
    logout: () => {
      void logout();
    },
  };
}
