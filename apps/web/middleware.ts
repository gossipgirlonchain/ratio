/**
 * The access wall: closed devnet beta. Every page 307s to /gate unless
 * the browser carries a validly signed access cookie. The gate, its API,
 * and static assets are the only things reachable without one.
 */
import { NextResponse, type NextRequest } from "next/server";

import { ACCESS_COOKIE, verifyAccess } from "./lib/access";

export async function middleware(req: NextRequest) {
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
