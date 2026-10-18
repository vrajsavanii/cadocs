import { getDashboard } from "@/lib/db";
import { handle, ok } from "@/lib/api";

export const dynamic = "force-dynamic";

export function GET() {
  try {
    return ok(getDashboard());
  } catch (err) {
    return handle(err);
  }
}
