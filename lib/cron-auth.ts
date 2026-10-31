import { timingSafeEqual } from "crypto";

/**
 * Authorisation for the scheduled cron endpoints.
 *
 * V1 audit DEF-001: the handlers used to accept Vercel's own cron markers
 * (`x-vercel-cron` header / `vercel-cron` user agent). Those headers are
 * attacker-controllable from the open internet, so a spoofed request could run
 * the sweeps early — reproduced against production before the fix. Now the
 * only accepted proof is `Authorization: Bearer $CRON_SECRET` (compared with a
 * constant-time equality), which Vercel Cron attaches automatically once the
 * variable is set on the project. An unset secret authorises no one.
 */
export function isCronAuthorized(req: Request): boolean {
  const secret = (process.env.CRON_SECRET || "").trim();
  if (!secret) return false;
  const auth = (req.headers.get("authorization") || "").trim();
  const prefix = "Bearer ";
  if (auth.length !== prefix.length + secret.length || !auth.startsWith(prefix)) return false;
  try {
    return timingSafeEqual(Buffer.from(auth.slice(prefix.length), "utf8"), Buffer.from(secret, "utf8"));
  } catch {
    return false;
  }
}

export const CRON_UNAUTHORIZED_MESSAGE =
  "Unauthorized — set CRON_SECRET and pass it as `Authorization: Bearer $CRON_SECRET`. Vercel Cron sends this automatically once the variable is set.";
