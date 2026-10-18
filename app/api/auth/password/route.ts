import { bumpTokenVersion, logAudit, setUserPassword } from "@/lib/db";
import { handle, ok, readBody, str } from "@/lib/api";
import { rateLimit, verifyPassword } from "@/lib/crypto";
import { getSessionUser, SESSION_COOKIE } from "@/lib/auth";
import { cookies } from "next/headers";
import { getUserForLogin } from "@/lib/db";
import { signSession } from "@/lib/crypto";
import { SESSION_TTL_HOURS } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Rotate the signed-in user's own password. Requires the current password,
 * re-issues a fresh session token, and is audited (CERT-In style trail).
 */
export async function PATCH(req: Request) {
  try {
    const user = await getSessionUser();
    if (!user) return ok({ error: "Sign in required" }, 401);

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
    const limited = rateLimit(`pwchange:${ip}:${user.username}`, 5, 15 * 60_000);
    if (!limited.ok) return ok({ error: "Too many attempts — retry later" }, 429);

    const body = await readBody(req);
    const current = str(body.current_password, "Current password", { max: 200 });
    const next = str(body.new_password, "New password", { max: 200 });
    if (next.length < 8) return ok({ error: "New password must be at least 8 characters" }, 400);

    const row = getUserForLogin(user.username);
    if (!row || !verifyPassword(current, row.password_hash)) {
      logAudit({
        actor: user.username,
        action: "PASSWORD_CHANGE_FAILED",
        entity_type: "auth",
        detail: "Wrong current password supplied",
      });
      return ok({ error: "Current password is incorrect" }, 403);
    }

    setUserPassword(user.user_id, next);

    // Revoke every other session for this account, then issue a fresh token so
    // the current browser stays signed in.
    const version = bumpTokenVersion(user.user_id);
    const res = ok({ ok: true });
    const token = signSession({ uid: user.user_id, v: version }, SESSION_TTL_HOURS);
    res.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: new URL(req.url).protocol === "https:",
      path: "/",
      maxAge: SESSION_TTL_HOURS * 3600,
    });
    return res;
  } catch (err) {
    return handle(err);
  }
}