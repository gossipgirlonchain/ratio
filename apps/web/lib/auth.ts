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

export function useAuth(): {
  viewer: string | null;
  xUserId: string | null;
  ready: boolean;
  login: () => void;
  logout: () => void;
} {
  const { ready, authenticated, user, login, logout } = usePrivy();
  const twitter = user?.twitter ?? null;
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
