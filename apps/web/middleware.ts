/**
 * The access wall: closed devnet beta. Every page 307s to /gate unless
 * the browser carries a validly signed access cookie. The gate, its API,
 * and static assets are the only things reachable without one.
 */
import { NextResponse, type NextRequest } from "next/server";

import { ACCESS_COOKIE, verifyAccess } from "./lib/access";

/** Link-preview scrapers: allowed through to MARKET pages only, so the
 * share card renders. They read og tags; the app shell behind them is
 * useless without login. Everything else stays walled. */
const CRAWLER_UA = /twitterbot|facebookexternalhit|linkedinbot|slackbot|discordbot|telegrambot|whatsapp/i;

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
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
