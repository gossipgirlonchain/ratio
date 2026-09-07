"use client";

/**
 * The public sign-up page. Deliberately unbranded: no wordmark, no logo, no
 * product name. It describes the mechanic and takes an X login, nothing else.
 *
 * The list IS Privy. Every sign-up is a Privy user with a linked X account, so
 * there is no separate waitlist table to keep in sync and no second place for
 * an email to rot. Export from the Privy dashboard when it is time to invite.
 *
 * Login is X only, as everywhere else in this product: no connect-wallet, no
 * external wallet of any kind. See providers.tsx.
 */
import { usePrivy } from "@privy-io/react-auth";
import { useEffect, useState } from "react";

export default function SignupPage() {
  const { ready, authenticated, user, login } = usePrivy();
  // Privy state is only correct after mount; rendering it during SSR would
  // flash the wrong half of the page.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const handle = user?.twitter?.username ?? null;
  const settled = mounted && ready;

  return (
    <main className="su">
      <div className="su-card">
        {settled && authenticated ? (
          <>
            <h1 className="su-title">you&rsquo;re on the list</h1>
            <p className="su-lede">
              {handle ? `@${handle}` : "signed in"}. we&rsquo;ll get in touch when it opens.
            </p>
            <div className="su-done" aria-hidden="true">
              ✓
            </div>
          </>
        ) : (
          <>
            <h1 className="su-title">
              two tweets go in.
              <br />
              one comes out.
            </h1>
            <p className="su-lede">
              a reply and the post it answers, side by side. most likes after 24 hours
              wins. you can back either one.
            </p>
            <button className="su-btn" onClick={login} disabled={!settled}>
              {settled ? "sign up with X" : "…"}
            </button>
            <p className="su-note">
              X login only. no wallet to connect, no seed phrase, nothing to install.
            </p>
          </>
        )}
      </div>
    </main>
  );
}
