import { getSessionUser } from "@/lib/auth";
import { listQueuedMessages, markMessageStatus } from "@/lib/db";
import { fail, handle, ok, pick, readBody } from "@/lib/api";

export const dynamic = "force-dynamic";

/** The outbox: messages automation drafted, waiting for a human to send. */
export async function GET() {
  try {
    const user = await getSessionUser();
    if (!user) return ok({ error: "Sign in required" }, 401);
    return ok({ messages: listQueuedMessages(50) });
  } catch (err) {
    return handle(err);
  }
}

/** Marks a queued message as sent (or puts it back). Nothing is sent here. */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await getSessionUser();
    if (!user) return ok({ error: "Sign in required" }, 401);
    const { id } = await ctx.params;
    const body = await readBody(req);
    const status = pick(body.status, ["Sent", "Queued", "Dismissed"] as const, "Status");
    const message = markMessageStatus(id, status);
    if (!message) return fail("Message not found", 404);
    return ok({ message });
  } catch (err) {
    return handle(err);
  }
}
