import { getSettings, updateSettings } from "@/lib/db";
import { handle, ok, readBody } from "@/lib/api";

export const dynamic = "force-dynamic";

const ALLOWED = new Set([
  "firm_name",
  "firm_city",
  "firm_phone",
  "firm_email",
  "firm_gstin",
  "ca_member_no",
  "firm_address",
  "firm_tagline",
  "ai_enabled",
]);

export function GET() {
  try {
    return ok(getSettings());
  } catch (err) {
    return handle(err);
  }
}

export async function PUT(req: Request) {
  try {
    const body = await readBody(req);
    const patch: Record<string, string> = {};
    for (const [key, value] of Object.entries(body)) {
      if (ALLOWED.has(key) && (typeof value === "string" || typeof value === "number")) {
        patch[key] = String(value).slice(0, 300);
      }
    }
    return ok(updateSettings(patch));
  } catch (err) {
    return handle(err);
  }
}
