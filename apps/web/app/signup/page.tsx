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
import { XLogo } from "@ratio/ui";
import { useEffect, useState } from "react";

const TELEGRAM = "https://t.me/+g_F-r4Ck4yw4ZDY0";
const X_PROFILE = "https://x.com/ratiowtf";

/** Telegram mark. Inline rather than a dependency for one glyph. */
function TelegramLogo({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M21.94 4.3 18.9 19.1c-.23 1.02-.84 1.27-1.7.79l-4.7-3.46-2.27 2.18c-.25.25-.46.46-.94.46l.34-4.78 8.7-7.86c.38-.34-.08-.53-.59-.19L6.98 13.02 2.34 11.6c-1-.32-1.02-1 .21-1.49L20.65 3.1c.84-.3 1.57.2 1.29 1.2Z" />
    </svg>
  );
}

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
            {/* Only shown once someone is signed up. The teaser face stays
                anonymous; there is no point hiding the name from a person who
                just handed over their X account. */}
            <div className="su-links">
              <a className="su-link" href={TELEGRAM} target="_blank" rel="noreferrer">
                <TelegramLogo />
                join the telegram
              </a>
              <a className="su-link" href={X_PROFILE} target="_blank" rel="noreferrer">
                <XLogo size={13} />
                follow on X
              </a>
            </div>
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
