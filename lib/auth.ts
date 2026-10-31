/**
 * Authentication and authorisation for the practice suite.
 *
 * - Sessions are stateless HMAC-signed cookies (lib/crypto.ts) so every
 *   request can be verified cheaply; the user row is re-read from SQLite on
 *   each check so role changes and deletions apply immediately.
 * - `proxy.ts` enforces this policy at the edge of the app for every request;
 *   `getSessionUser` gives layouts/routes an independent server-side check.
 *
 * Roles:
 *   partner  — everything, including settings, user administration and deletes
 *   manager  — day-to-day operations: clients, compliance, billing, documents;
 *              cannot change settings/users or delete clients
 *   article  — read-only, plus creating own timesheets, logging messages and AI
 */
import { cookies } from "next/headers";
import { getUserById } from "./db";
import { verifySession } from "./crypto";
import type { AuthUser } from "./types";

export const SESSION_COOKIE = "ca_session";
export const SESSION_TTL_HOURS = 12;

export type Role = AuthUser["role"];

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Paths that never require a session. */
export function isPublicPath(pathname: string): boolean {
  if (pathname === "/login" || pathname === "/privacy") return true;
  if (pathname === "/api/auth/login" || pathname === "/api/health") return true;
  // Meta's webhooks carry no browser session; the handler verifies the request
  // itself (HMAC-SHA256 with X-Hub-Signature-256 / the subscription token).
  if (pathname === "/api/webhooks/whatsapp") return true;
  // Public product site and its lead capture (rate limited inside the route).
  if (pathname === "/site" || pathname.startsWith("/site/")) return true;
  if (pathname === "/api/public/demo-request") return true;
  // Scheduled sweeps carry no browser session: Vercel Cron (or an operator)
  // calls them with CRON_SECRET, which each /api/cron/* handler verifies
  // itself before doing any work. Requiring a session here would silently
  // kill every background job.
  if (pathname.startsWith("/api/cron/")) return true;
  // Build assets, source maps, favicons — not application surfaces.
  if (pathname.startsWith("/_next")) return true;
  if (/\.[a-z0-9]{1,5}$/i.test(pathname)) return true;
  return false;
}

/**
 * Central permission policy: given the caller's role, HTTP method and path,
 * may this request proceed? Reads are allowed for every authenticated role;
 * mutations follow the tier rules above.
 */
export function canAccess(role: string, method: string, pathname: string): boolean {
  if (!WRITE_METHODS.has(method)) return true;
  if (role === "partner") return true;

  // Anyone signed in may ask the AI copilot and end their own session,
  // or change their own password.
  if (/^\/api\/(ai\/|auth\/(logout|password))/.test(pathname)) return true;

  if (role === "manager") {
    if (/^\/api\/(settings|users)/.test(pathname)) return false;
    if (method === "DELETE" && /^\/api\/clients(\/|$)/.test(pathname)) return false;
    return true;
  }

  if (role === "article") {
    // Articles may move their assigned work through the workflow; the workflow
    // route itself enforces which transitions and actions their role allows.
    // Engagement records are PATCH-only for them: generation controls
    // (preview/generate/runs) and deletions are manager+, in depth alongside
    // the checks inside those handlers.
    if (/^\/api\/engagements(\/|$)/.test(pathname)) return method === "PATCH";
    return /^\/api\/(timesheets|messages|workflow)(\/|$)/.test(pathname);
  }

  return false;
}

/** Resolves the signed session cookie to a live user row (server components). */
export async function getSessionUser(): Promise<AuthUser | null> {
  try {
    const jar = await cookies();
    const token = jar.get(SESSION_COOKIE)?.value;
    const claims = verifySession(token);
    if (!claims) return null;
    const user = getUserById(claims.uid);
    if (!user) return null;
    // Server-side revocation: logout/password change bumps token_version.
    if ((user.token_version ?? 0) !== (claims.v ?? 0)) return null;
    return user;
  } catch {
    return null;
  }
}

/** Same check for route handlers; returns the user or null. */
export async function userFromRequest(): Promise<AuthUser | null> {
  return getSessionUser();
}

export function isPartner(user: AuthUser | null): user is AuthUser & { role: "partner" } {
  return user?.role === "partner";
}

export function isManager(user: AuthUser | null): user is AuthUser & { role: "manager" } {
  return user?.role === "manager";
}

export function roleLabel(role: Role): string {
  return role === "partner" ? "Partner" : role === "manager" ? "Manager" : "Article assistant";
}
