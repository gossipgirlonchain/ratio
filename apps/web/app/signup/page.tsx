"use client";

/**
 * The public sign-up page. Deliberately unbranded and deliberately
 * unexplained: no wordmark, no logo, no product name, and no description of
 * what the thing does. One line and a button. It is a teaser, so the job is
 * to make someone curious enough to sign in, not to inform them.
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
            <h1 className="su-title">you&rsquo;re in.</h1>
            <p className="su-lede">{handle ? `@${handle}` : "see you soon"}</p>
          </>
        ) : (
          <>
            <h1 className="su-title">
              two tweets go in.
              <br />
              one comes out.
            </h1>
            <button className="su-btn" onClick={login} disabled={!settled}>
              {settled ? "sign up with X" : "…"}
            </button>
          </>
        )}
      </div>
    </main>
  );
}
