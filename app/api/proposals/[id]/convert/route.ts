import { convertProposal } from "@/lib/db";
import { fail, handle, ok } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const result = convertProposal(id);
    if (!result) return fail("Proposal not found", 404);
    return ok(result, result.created ? 201 : 200);
  } catch (err) {
    return handle(err);
  }
}
