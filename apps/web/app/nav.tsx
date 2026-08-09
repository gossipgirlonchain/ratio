"use client";

/**
 * Top bar: logo, inline search, leaderboard, and profile-or-login.
 * Search is not a page — results open under the input as you type,
 * matching handles and tweet text. The info pages live in the footer.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { allHandles, markets } from "../lib/fixtures";
import { useAuth } from "../lib/auth";

export function Nav() {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const { viewer, login } = useAuth();
  const box = useRef<HTMLDivElement>(null);

  const needle = q.trim().replace(/^@/, "").toLowerCase();
  const handleHits = needle
    ? allHandles().filter((h) => h.toLowerCase().includes(needle)).slice(0, 4)
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

  return (
    <nav className="nav">
      <Link className="nav-home" href="/">
        ratio
      </Link>
      <div className="nav-search" ref={box}>
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
      <div className="nav-links">
        <Link href="/leaderboard">leaderboard</Link>
        {viewer ? (
          <Link className="nav-profile" href={`/${viewer}`}>
            @{viewer}
          </Link>
        ) : (
          <button className="nav-login" onClick={login}>
            log in
          </button>
        )}
      </div>
    </nav>
  );
}
