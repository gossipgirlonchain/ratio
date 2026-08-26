"use client";

/**
 * Nav bell: settled markets you had money in. Unseen results show a
 * count; opening the panel marks them seen (localStorage). Data comes
 * straight from the live world, so this works with zero new backend.
 */
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { settledOutcomesFor, useLive } from "../lib/live";

const LS_KEY = "ratio-seen-results";

const fmtUsd = (n: number) =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const loadSeen = (): Set<string> => {
  try {
    return new Set(JSON.parse(localStorage.getItem(LS_KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
};

export function Notifications({ viewer }: { viewer: string | null }) {
  const world = useLive();
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState<Set<string>>(new Set());
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setSeen(loadSeen());
  }, []);

  if (!viewer) return null;
  const outcomes = settledOutcomesFor(world, viewer);
  if (outcomes.length === 0) return null;
  const unseen = outcomes.filter((o) => !seen.has(o.marketId)).length;

  const openPanel = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
    setOpen(true);
    const next = new Set([...seen, ...outcomes.map((o) => o.marketId)]);
    setSeen(next);
    try {
      localStorage.setItem(LS_KEY, JSON.stringify([...next]));
    } catch {
      // storage blocked: the count just stays
    }
  };
  const leave = () => {
    closeTimer.current = setTimeout(() => setOpen(false), 250);
  };

  return (
    <div className="notif-wrap" onMouseEnter={openPanel} onMouseLeave={leave}>
      <button className="notif-bell" onClick={() => (open ? setOpen(false) : openPanel())} aria-label="results">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M12 2a6 6 0 0 0-6 6v3.2L4.2 15a1 1 0 0 0 .9 1.5h13.8a1 1 0 0 0 .9-1.5L18 11.2V8a6 6 0 0 0-6-6zM9.8 18a2.3 2.3 0 0 0 4.4 0z" />
        </svg>
        {unseen > 0 && <span className="notif-count">{unseen}</span>}
      </button>
      {open && (
        <div className="notif-pop">
          {outcomes.slice(0, 8).map((o) => (
            <Link className="notif-row" href={`/m/${o.marketId}`} key={o.marketId}>
              <span className={o.won ? "notif-result notif-won" : "notif-result"}>
                {o.won ? `won ${fmtUsd(o.payoutUsd)}` : `lost ${fmtUsd(o.stakedUsd - o.payoutUsd)}`}
              </span>
              <span className="notif-detail">
                @{o.sideHandle} beat @{o.otherHandle}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
