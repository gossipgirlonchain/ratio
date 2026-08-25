"use client";

/**
 * Thin top bar: search and auth. Nothing else — navigation lives in the
 * sidebar. Search opens results under the input as you type.
 */
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

import { WalletChip } from "../components/WalletChip";
import { useAuth } from "../lib/auth";
import { allHandles, openPositionsFor, useLive } from "../lib/live";

export function Nav() {
  const pathname = usePathname();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const { viewer, login } = useAuth();
  const world = useLive();
  const markets = world.markets;

  const needle = q.trim().replace(/^@/, "").toLowerCase();
  const handleHits = needle
    ? allHandles(world).filter((h) => h.toLowerCase().includes(needle)).slice(0, 4)
    : [];
  const marketHits = needle
    ? markets
        .filter(
          (m) =>
            m.data.a.text.toLowerCase().includes(needle) ||
            m.data.b.text.toLowerCase().includes(needle) ||
            m.data.a.handle.toLowerCase().includes(needle) ||
            m.data.b.handle.toLowerCase().includes(needle),
        )
        .slice(0, 4)
    : [];

  const go = (href: string) => {
    setQ("");
    setOpen(false);
    router.push(href);
  };

  if (pathname === "/gate") return null;
  return (
    <header className="topbar">
      <div className="nav-search">
        <input
          className="nav-search-input"
          placeholder="search"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
        />
        {open && needle && (
          <div className="nav-results">
            {handleHits.map((h) => (
              <button key={h} className="nav-result" onMouseDown={() => go(`/${h}`)}>
                @{h}
              </button>
            ))}
            {marketHits.map((m) => (
              <button
                key={m.data.marketId}
                className="nav-result nav-result-market"
                onMouseDown={() => go(`/m/${m.data.marketId}`)}
              >
                @{m.data.b.handle} vs @{m.data.a.handle}
              </button>
            ))}
            {handleHits.length === 0 && marketHits.length === 0 && (
              <span className="nav-result nav-result-empty">nothing yet</span>
            )}
          </div>
        )}
      </div>
      {viewer ? (
        <div className="nav-viewer">
          <WalletChip
            stakedUsd={openPositionsFor(world, viewer).reduce((s, p) => s + p.netStakedUsd, 0)}
          />
          <Link className="nav-profile" href={`/${viewer}`}>
            @{viewer}
          </Link>
        </div>
      ) : (
        <button className="nav-login" onClick={login}>
          log in
        </button>
      )}
    </header>
  );
}
