/**
 * The access wall: closed devnet beta. Every page 307s to /gate unless
 * the browser carries a validly signed access cookie. The gate, its API,
 * and static assets are the only things reachable without one.
 */
import { NextResponse, type NextRequest } from "next/server";

import { ACCESS_COOKIE, verifyAccess } from "./lib/access";

/**
 * Public paths, reachable with no access cookie.
 *
 * /signup is the one page meant to be shared outside the beta, so it has to
 * sit outside the wall. It is deliberately unbranded and does nothing except
 * take an X login, so opening it exposes no product surface.
 */
const PUBLIC_PATHS = new Set(["/signup"]);

/** Creator application: a static page shared with outside creators, so it
 * lives outside the wall like /signup. Prefix match covers the rewrite
 * target /creator-apply/index.html too. */
const isCreatorApply = (p: string) => p === "/creator-apply" || p.startsWith("/creator-apply/");

/** Link-preview scrapers: allowed through to MARKET pages only, so the
 * share card renders. They read og tags; the app shell behind them is
 * useless without login. Everything else stays walled. */
const CRAWLER_UA = /twitterbot|facebookexternalhit|linkedinbot|slackbot|discordbot|telegrambot|whatsapp/i;

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PATHS.has(pathname) || isCreatorApply(pathname)) return NextResponse.next();
  // the share image itself is public: X fetches it with no cookie
  if (/^\/m\/[^/]+\/opengraph-image/.test(pathname)) return NextResponse.next();
  if (
    /^\/m\/[^/]+$/.test(pathname) &&
    CRAWLER_UA.test(req.headers.get("user-agent") ?? "")
  ) {
    return NextResponse.next();
  }
  const secret = process.env.ACCESS_COOKIE_SECRET;
  // No secret configured (e.g. a fresh clone): fail CLOSED, not open.
  if (!secret) {
    return req.nextUrl.pathname === "/gate"
      ? NextResponse.next()
      : NextResponse.redirect(new URL("/gate", req.url));
  }
  const ok = await verifyAccess(secret, req.cookies.get(ACCESS_COOKIE)?.value);
  if (ok) {
    // gated visitors don't need the gate page again
    if (req.nextUrl.pathname === "/gate") {
      return NextResponse.redirect(new URL("/", req.url));
    }
    return NextResponse.next();
  }
  if (req.nextUrl.pathname === "/gate") return NextResponse.next();
  return NextResponse.redirect(new URL("/gate", req.url));
}

export const config = {
  // everything except the gate API, Next internals, and static files
  // /api excluded wholly: every API route enforces its own auth
  // (redeem is public by design; admin routes check ADMIN_KEY).
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
