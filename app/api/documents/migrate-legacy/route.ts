import { getSessionUser } from "@/lib/auth";
import { migrateLegacyDocuments } from "@/lib/documents";
import { fail, handle, ok } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * Operator action (POST, partner only): re-homes documents uploaded before
 * object storage into the current storage provider with verified checksums.
 * Idempotent and retry-safe by design; the original legacy files are never
 * deleted here — the operator removes them only after reviewing the report.
 */
export async function POST() {
  try {
    const user = await getSessionUser();
    if (!user) return fail("Sign in required", 401);
    if (user.role !== "partner") return fail("Only a partner can run the legacy document migration", 403);
    const report = await migrateLegacyDocuments(user.name);
    return ok(report);
  } catch (err) {
    return handle(err);
  }
}
