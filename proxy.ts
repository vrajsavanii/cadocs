/**
 * Next.js proxy — runs on the Node.js runtime for every request (Next 16
 * convention). This is THE gate for the practice suite:
 *
 *   1. Verifies the HMAC session cookie and resolves the user in SQLite.
 *   2. Redirects unauthenticated browsers to /login; APIs get 401 JSON.
 *   3. Enforces the central role policy (lib/auth.ts) on every mutation → 403.
 *   4. Blocks cross-origin mutating requests (CSRF defence): an Origin header
 *      that does not match the request host is rejected outright.
 *   5. Applies a generous per-user write rate limit (abuse brake).
 *
 * Public paths: /login, /privacy, /site (the marketing pages),
 * /api/public/demo-request, /api/auth/login, /api/health and build assets.
 * Password brute force is limited separately in the login route, and the
 * public lead endpoint limits itself per IP.
 *
 * Every pass-through carries the pathname as `x-pathname` so layouts can tell
 * which surface they are rendering — the root layout uses it to drop the
 * practice shell on the public site.
 */
import { NextRequest, NextResponse } from "next/server";
import { canAccess, isPublicPath, SESSION_COOKIE } from "@/lib/auth";
import { getUserById } from "@/lib/db";
import { rateLimit, verifySession } from "@/lib/crypto";

export default async function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  const pass = () => {
    const headers = new Headers(req.headers);
    headers.set("x-pathname", pathname);
    return NextResponse.next({ request: { headers } });
  };

  if (isPublicPath(pathname)) return pass();

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const claims = verifySession(token);
  const user = claims ? getUserById(claims.uid) : null;
  // Revoked by logout or a password change? Treat exactly like no session.
  const revoked = Boolean(claims && user && (user.token_version ?? 0) !== (claims.v ?? 0));
  if (revoked) {
    if (pathname.startsWith("/api")) {
      const res = NextResponse.json({ error: "Session ended — sign in again" }, { status: 401 });
      res.cookies.delete(SESSION_COOKIE);
      return res;
    }
    const loginUrl = new URL("/login", req.url);
    const res = NextResponse.redirect(loginUrl);
    res.cookies.delete(SESSION_COOKIE);
    return res;
  }

  if (!user) {
    if (pathname.startsWith("/api")) {
      return NextResponse.json({ error: "Sign in required" }, { status: 401 });
    }
    // The front door for visitors is the public product site, not a login box.
    if (pathname === "/") return NextResponse.redirect(new URL("/site", req.url));
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("next", `${pathname}${search}`);
    const res = NextResponse.redirect(loginUrl);
    res.cookies.delete(SESSION_COOKIE);
    return res;
  }

  const method = req.method;

  // CSRF: browsers always attach Origin to cross-site POSTs; anything that
  // does not match our own host is refused before it reaches a handler.
  if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
    const origin = req.headers.get("origin");
    const host = req.headers.get("host");
    if (origin && host) {
      try {
        if (new URL(origin).host !== host) {
          if (pathname.startsWith("/api")) {
            return NextResponse.json({ error: "Cross-origin request blocked" }, { status: 403 });
          }
          return new NextResponse("Cross-origin request blocked", { status: 403 });
        }
      } catch {
        return NextResponse.json({ error: "Invalid Origin header" }, { status: 403 });
      }
    }

    // Abuse brake: 300 mutating requests/minute per signed-in user.
    const limited = rateLimit(`write:${user.user_id}`, 300, 60_000);
    if (!limited.ok) {
      return NextResponse.json(
        { error: `Too many requests — retry in ${limited.retryAfterSec}s` },
        { status: 429, headers: { "Retry-After": String(limited.retryAfterSec) } },
      );
    }
  }

  if (!canAccess(user.role, method, pathname)) {
    if (pathname.startsWith("/api")) {
      return NextResponse.json({ error: `Your role (${user.role}) cannot perform this action` }, { status: 403 });
    }
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return pass();
}