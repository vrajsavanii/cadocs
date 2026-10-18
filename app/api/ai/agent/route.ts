import { handle, ok, readBody, str } from "@/lib/api";
import { getSessionUser } from "@/lib/auth";
import { AiQuotaError, runAgent } from "@/lib/ai-agent";
import { rateLimit } from "@/lib/crypto";

export const dynamic = "force-dynamic";

/** The practice agent: tools + proposals. Used by the palette and copilot page. */
export async function POST(req: Request) {
  try {
    const user = await getSessionUser();
    if (!user) return ok({ error: "Sign in required" }, 401);

    const limited = rateLimit(`agent:${user.user_id}`, 20, 60_000);
    if (!limited.ok) {
      return ok({ error: `Slow down — retry in ${limited.retryAfterSec}s` }, 429);
    }

    const body = await readBody(req);
    const message = str(body.message, "Message", { max: 2000 });
    const result = await runAgent({ user, message });
    return ok(result);
  } catch (err) {
    if (err instanceof AiQuotaError) return ok({ error: err.message }, 429);
    return handle(err);
  }
}