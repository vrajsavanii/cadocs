import { handle, ok } from "@/lib/api";
import { aiDisclosure, complete } from "@/lib/ai";
import { deterministicBrief } from "@/lib/insights";
import { rateLimit } from "@/lib/crypto";
import { getDashboard } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Practice brief: 3-4 sentences on what needs attention today.
 * - With a configured provider the deterministic brief is rewritten for
 *   readability under a hard rule: no number may change.
 * - Keyless/off: the deterministic brief itself (always correct, from live rows).
 */
export async function GET(req: Request) {
  try {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
    const limited = rateLimit(`ai-brief:${ip}`, 20, 60_000);
    if (!limited.ok) return ok({ error: "Too many requests" }, 429);

    const facts = deterministicBrief();
    const k = getDashboard().kpis;

    const result = await complete({
      system:
        "You write a crisp morning brief for the managing partner of an Indian CA firm. " +
        "Rewrite the fact sheet below into 3-4 tight sentences with a clear first action. " +
        "Plain text (no markdown headers), confident tone, keep every number exactly as given, add no new facts. " +
        `Live figures: ${k.overdueCompliance} overdue filings, ${k.complianceDueThisWeek} due this week, ` +
        `${k.pendingDocuments} pending documents, collection rate ${k.collectionRate}%.`,
      user: facts,
      maxTokens: 220,
      temperature: 0.4,
    });

    return ok({
      brief: result?.text ?? facts,
      source: result ? result.provider : "practice-data",
      disclosure: aiDisclosure(),
    });
  } catch (err) {
    return handle(err);
  }
}