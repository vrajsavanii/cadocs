import { getSessionUser } from "@/lib/auth";
import { generateEngagements, GenerationError } from "@/lib/engagement-engine";
import { fail, handle, ok, readBody } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const user = await getSessionUser();
    if (!user) return fail("Sign in required", 401);
    if (user.role !== "partner" && user.role !== "manager") {
      return fail("Only a manager or partner can generate engagements", 403);
    }
    const body = await readBody(req);
    // A commit must be explicit: the client reviewed the preview and confirmed.
    if (body.confirmed !== true) {
      return fail("Confirm the generation preview before creating engagements", 400);
    }
    const result = generateEngagements({
      from: typeof body.from === "string" ? body.from : undefined,
      to: typeof body.to === "string" ? body.to : undefined,
      clientId: typeof body.client_id === "string" ? body.client_id : undefined,
      serviceId: typeof body.service_id === "string" ? body.service_id : undefined,
      actor: user.name,
      role: user.role,
      trigger: "manual",
      confirmed: true,
    });
    return ok(result, 201);
  } catch (err) {
    if (err instanceof GenerationError) {
      return fail(err.message, 409);
    }
    return handle(err);
  }
}
