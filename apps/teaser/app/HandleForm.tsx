"use client";

/**
 * Screen 1's whole job. Accepts "@handle" or "handle"; normalized here so
 * every downstream route sees one shape. Reused as the look-someone-else-up
 * box on empty states.
 */

import { useRouter } from "next/navigation";
import { useState } from "react";

export function HandleForm({
  initial = "",
  autoFocus = false,
}: {
  initial?: string;
  autoFocus?: boolean;
}) {
  const router = useRouter();
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);

  const go = (e: React.FormEvent) => {
    e.preventDefault();
    const handle = value.trim().replace(/^@+/, "").toLowerCase();
    if (!handle) return;
    setBusy(true);
    router.push(`/${encodeURIComponent(handle)}`);
  };

  return (
    <form className="handle-form" onSubmit={go}>
      <input
        className="handle-input"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="@yourhandle"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        autoFocus={autoFocus}
        aria-label="x handle"
      />
      <button className="btn" type="submit" disabled={busy}>
        {busy ? "scoring…" : "score me"}
      </button>
    </form>
  );
}
