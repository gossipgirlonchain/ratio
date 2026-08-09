"use client";

/**
 * Find an account or a market. Handle search resolves to profile pages,
 * including profiles of people who have never signed up.
 */
import Link from "next/link";
import { useState } from "react";

import { allHandles, markets } from "../../lib/fixtures";
import { useMounted } from "../../lib/useMounted";

export default function SearchPage() {
  const mounted = useMounted();
  const [q, setQ] = useState("");
  if (!mounted) return null;

  const needle = q.trim().replace(/^@/, "").toLowerCase();
  const handleHits = needle
    ? allHandles().filter((h) => h.toLowerCase().includes(needle))
    : [];
  const marketHits = needle
    ? markets.filter(
        (m) =>
          m.data.a.text.toLowerCase().includes(needle) ||
          m.data.b.text.toLowerCase().includes(needle) ||
          m.data.a.handle.toLowerCase().includes(needle) ||
          m.data.b.handle.toLowerCase().includes(needle),
      )
    : [];

  return (
    <main className="page">
      <h1 className="page-title">search</h1>
      <input
        className="search-input"
        placeholder="@handle or words from a tweet"
        autoFocus
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {needle && (
        <>
          {handleHits.length > 0 && (
            <section className="card">
              <h2>people</h2>
              {handleHits.map((h) => (
                <p key={h}>
                  <Link href={`/${h}`}>@{h}</Link>
                </p>
              ))}
            </section>
          )}
          {marketHits.length > 0 && (
            <section className="card">
              <h2>markets</h2>
              {marketHits.map((m) => (
                <p key={m.data.marketId}>
                  <Link href={`/m/${m.data.marketId}`}>
                    @{m.data.b.handle} vs @{m.data.a.handle}
                  </Link>
                </p>
              ))}
            </section>
          )}
          {handleHits.length === 0 && marketHits.length === 0 && (
            <p className="page-empty">nothing yet for &quot;{q}&quot;.</p>
          )}
        </>
      )}
    </main>
  );
}
