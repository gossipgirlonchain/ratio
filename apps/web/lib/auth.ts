"use client";

/**
 * Demo auth: stands in for X login via Privy. Logged out is the default
 * and every page stays fully readable; actions (betting, claiming,
 * depositing, withdrawing) prompt login at the point of action, never
 * before. login() here instantly becomes @bigaccount so the owner states
 * are demoable; the real flow is Privy's X OAuth.
 */
import { useEffect, useState } from "react";

const KEY = "ratio-demo-viewer";
const DEMO_USER = "bigaccount";

export function useAuth() {
  const [viewer, setViewer] = useState<string | null>(null);
  useEffect(() => {
    setViewer(localStorage.getItem(KEY));
    const onStorage = () => setViewer(localStorage.getItem(KEY));
    window.addEventListener("storage", onStorage);
    window.addEventListener("ratio-auth", onStorage);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("ratio-auth", onStorage);
    };
  }, []);
  return {
    viewer,
    login: () => {
      localStorage.setItem(KEY, DEMO_USER);
      window.dispatchEvent(new Event("ratio-auth"));
    },
    logout: () => {
      localStorage.removeItem(KEY);
      window.dispatchEvent(new Event("ratio-auth"));
    },
  };
}
