import { getSessionUser } from "@/lib/auth";
import { handle, ok } from "@/lib/api";
import { getUnifiedReports, parseReportFilters } from "@/lib/reports";

export const dynamic = "force-dynamic";

/**
 * Unified reporting JSON (Prompt 13). Filters arrive as query params and are
 * validated server-side; invalid values are reported without failing the
 * whole request. Financial and team sections are computed only for
 * partner/manager sessions.
 */
export async function GET(req: Request) {
  try {
    const user = await getSessionUser();
    if (!user) return ok(getUnifiedReports(parseReportFilters().filters, null), 200);
    const params = new URL(req.url).searchParams;
    const raw: Record<string, string> = {};
    for (const [key, value] of params.entries()) raw[key] = value;
    const { filters, invalid } = parseReportFilters(raw);
    const pack = getUnifiedReports(filters, user);
    if (invalid.length) return ok({ ...pack, filter_warnings: invalid });
    return ok(pack);
  } catch (err) {
    return handle(err);
  }
}
