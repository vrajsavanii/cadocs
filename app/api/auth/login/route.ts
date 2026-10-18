import { getUserForLogin, logAudit, recordLogin } from "@/lib/db";
import { handle, ok, readBody, str } from "@/lib/api";
import { rateLimit, signSession, verifyPassword } from "@/lib/crypto";
import { SESSION_COOKIE, SESSION_TTL_HOURS } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await readBody(req);
    const username = str(body.username, "Username", { max: 60 }).toLowerCase().trim();
    const password = str(body.password, "Password", { max: 200 });

    // Brute-force brake: 10 attempts / 15 min per IP + username, then 429.
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
    const limited = rateLimit(`login:${ip}:${username}`, 10, 15 * 60_000);
    if (!limited.ok) {
      return ok({ error: `Too many attempts — retry in ${limited.retryAfterSec}s` }, 429);
    }

    const user = getUserForLogin(username);
    if (!user || !verifyPassword(password, user.password_hash)) {
      logAudit({
        actor: username,
        action: "LOGIN_FAILED",
        entity_type: "auth",
        detail: `Failed sign-in attempt for "${username}" from ${ip}`,
      });
      return ok({ error: "Incorrect username or password" }, 401);
    }

    const token = signSession({ uid: user.user_id, v: user.token_version ?? 0 }, SESSION_TTL_HOURS);
    recordLogin(user.user_id);
    logAudit({
      actor: user.username,
      action: "LOGIN",
      entity_type: "auth",
      entity_id: user.user_id,
      detail: `${user.name} signed in (${user.role})`,
    });

    const res = ok({
      user: { user_id: user.user_id, username: user.username, name: user.name, role: user.role },
    });
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