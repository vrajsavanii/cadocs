import { deleteUdin } from "@/lib/db";
import { fail, handle, ok } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    if (!deleteUdin(id)) return fail("UDIN record not found", 404);
    return ok({ deleted: id });
  } catch (err) {
    return handle(err);
  }
}
