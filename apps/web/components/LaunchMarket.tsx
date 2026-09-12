"use client";

/**
 * "launch a market": the one thing a visitor can do that the site itself
 * cannot do for them. Markets open on X, by tagging the bot under a reply, so
 * the button explains the three steps and sends them there. No form, no
 * compose intent: the tag has to be a REPLY to the tweet in question, and
 * only X can do that.
 */
import { useEffect, useState } from "react";

import { BOT_HANDLE } from "@ratio/config";

export function LaunchMarket() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button className="launch-btn" onClick={() => setOpen(true)}>
        launch a market
      </button>
      {open && (
        <div className="welcome-scrim" role="dialog" aria-label="launch a market" onClick={() => setOpen(false)}>
          <div className="welcome card" onClick={(e) => e.stopPropagation()}>
            <h2 className="welcome-title">launch a market</h2>
            <ol className="welcome-steps">
              <li>find a reply or quote tweet that is under 12 hours old. that tweet is one side, the tweet it answers is the other.</li>
              <li>reply to it and tag @{BOT_HANDLE}. nothing else needed.</li>
              <li>the bot opens the market and posts the link. 24 hours, most likes wins.</li>
            </ol>
            <p className="welcome-note">
              you cannot open a market on your own post. you can tag your own reply.
            </p>
            <div className="welcome-row">
              <a className="gate-btn launch-go" href="https://x.com" target="_blank" rel="noreferrer" onClick={() => setOpen(false)}>
                go to x
              </a>
              <button className="welcome-more launch-close" onClick={() => setOpen(false)}>close</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
