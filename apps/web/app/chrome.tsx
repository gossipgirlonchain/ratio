"use client";

/**
 * The app shell, and the pages that must not have it.
 *
 * Everything used to render inside the sidebar + nav + scanner, including the
 * pages meant to be seen by people who are not users yet. /signup exists to be
 * posted publicly and is deliberately unbranded, so wrapping it in a wordmark,
 * a nav and a market scanner defeats the entire point of it.
 *
 * Chrome is opt-OUT rather than opt-in: a new page gets the app shell unless it
 * says otherwise, which is the right default when almost every page is behind
 * the wall.
 */
import { usePathname } from "next/navigation";

import { ScannerPanel } from "../components/ScannerPanel";
import { MobileNav } from "./mobile-nav";
import { Nav } from "./nav";
import { Sidebar } from "./sidebar";

/** Rendered bare: no shell, no nav, no branding. */
const BARE = new Set(["/signup"]);

export function Chrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (BARE.has(pathname)) return <>{children}</>;

  return (
    <>
      <div className="shell">
        <Sidebar />
        <div className="main-col">
          <Nav />
          {children}
        </div>
      </div>
      {/* layout-mounted so the conversation survives navigation */}
      <ScannerPanel />
      {/* mobile only: the sidebar hides under 900px */}
      <MobileNav />
    </>
  );
}
