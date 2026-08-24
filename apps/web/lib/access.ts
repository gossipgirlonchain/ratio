/**
 * Access-wall crypto, shared by the edge middleware and the node API
 * routes: a cookie payload signed with ACCESS_COOKIE_SECRET (HMAC
 * SHA-256 over Web Crypto, so it runs on the edge). The cookie proves
 * "this browser redeemed a real code once"; the database stays the
 * source of truth for which codes exist and who burned them.
 */

export const ACCESS_COOKIE = "ratio-access";

const enc = new TextEncoder();

// Edge runtime has no Buffer: base64url by hand.
const b64url = (bytes: ArrayBuffer): string => {
  let s = "";
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const sign = async (secret: string, payload: string): Promise<string> => {
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  return b64url(await crypto.subtle.sign("HMAC", key, enc.encode(payload)));
};

export async function signAccess(secret: string, code: string): Promise<string> {
  const payload = `${code}.${Date.now()}`;
  return `${payload}.${await sign(secret, payload)}`;
}

export async function verifyAccess(secret: string, cookie: string | undefined): Promise<boolean> {
  if (!cookie) return false;
  const i = cookie.lastIndexOf(".");
  if (i <= 0) return false;
  return (await sign(secret, cookie.slice(0, i))) === cookie.slice(i + 1);
}
