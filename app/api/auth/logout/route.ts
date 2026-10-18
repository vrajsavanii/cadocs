import { bumpTokenVersion, logAudit } from "@/lib/db";
import { ok } from "@/lib/api";
import { getSessionUser, SESSION_COOKIE } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Ends the session server-side: bumping the user's token version revokes every
 * outstanding cookie for this account (including copies replayed from disk),
 * then the cookie itself is cleared.
 */
export async function POST() {
  const user = await getSessionUser();
  if (user) {
    bumpTokenVersion(user.user_id);
    logAudit({ actor: user.username, action: "LOGOUT", entity_type: "auth", detail: "Session ended, all tokens revoked" });
  }

  const res = ok({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  return res;
}