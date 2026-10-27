import { getSessionUser } from "@/lib/auth";
import { previewGeneration } from "@/lib/engagement-engine";
import { fail, handle, ok, readBody } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const user = await getSessionUser();
    if (!user) return fail("Sign in required", 401);
    if (user.role !== "partner" && user.role !== "manager") {
      return fail("Only a manager or partner can prepare a generation run", 403);
    }
    const body = await readBody(req);
    const result = previewGeneration({
      from: typeof body.from === "string" ? body.from : undefined,
      to: typeof body.to === "string" ? body.to : undefined,
      clientId: typeof body.client_id === "string" ? body.client_id : undefined,
      serviceId: typeof body.service_id === "string" ? body.service_id : undefined,
      limit: Number(body.limit) || 500,
    });
    return ok({ preview: true, ...result });
  } catch (err) {
    return handle(err);
  }
}
