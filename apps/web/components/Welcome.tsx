"use client";

/**
 * First visit: how it works in plain english, once. Dismiss stores a
 * flag; the /how page stays the long version.
 */
import Link from "next/link";
import { useEffect, useState } from "react";

const LS_KEY = "ratio-seen-how";

export function Welcome() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    try {
      if (!localStorage.getItem(LS_KEY)) setShow(true);
    } catch {
      // storage blocked: never show, never crash
    }
  }, []);
  if (!show) return null;
  const dismiss = () => {
    try {
      localStorage.setItem(LS_KEY, "1");
    } catch {
      // fine
    }
    setShow(false);
  };
  return (
    <div className="welcome-scrim" role="dialog" aria-label="how ratio works">
      <div className="welcome card">
        <h2 className="welcome-title">how ratio works</h2>
        <ol className="welcome-steps">
          <li>two tweets go head to head. most likes when the clock runs out wins.</li>
          <li>pick a side and stake. winners split the pot.</li>
          <li>open your own market: tag @ratiowtf under any reply or quote tweet on x.</li>
          <li>bet from x too: reply to either tweet with something like &quot;@ratiowtf $10 @handle&quot;.</li>
        </ol>
        <p className="welcome-note">
          this is the devnet beta, so the money is play money. grab free SOL
          from the faucet, send it to your wallet address in the top bar, and
          you are in.
        </p>
        <div className="welcome-row">
          <button className="gate-btn" onClick={dismiss}>got it</button>
          <Link className="welcome-more" href="/how" onClick={dismiss}>the full rules</Link>
        </div>
      </div>
    </div>
  );
}
