import { handle, ok, readBody, str } from "@/lib/api";
import { createLead } from "@/lib/db";
import { rateLimit } from "@/lib/crypto";

export const dynamic = "force-dynamic";

/**
 * Public demo-request capture for the marketing site.
 *
 * Deliberately unauthenticated (prospects have no account) but tightly scoped:
 * it can only ever create a lead, it is rate limited per IP, it silently
 * absorbs honeypot hits, and the score/category it assigns are the same ones
 * the firm uses to triage enquiries by hand.
 */
export async function POST(req: Request) {
  try {
    // Public, but not third-party-postable: browsers attach Origin to any
    // cross-site request, and a public write endpoint is exactly what spam
    // scripts look for. Direct API callers send no Origin and are unaffected.
    const origin = req.headers.get("origin");
    const host = req.headers.get("host");
    if (origin && host) {
      try {
        if (new URL(origin).host !== host) return ok({ error: "Cross-origin request blocked" }, 403);
      } catch {
        return ok({ error: "Invalid Origin header" }, 403);
      }
    }

    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("x-real-ip") ||
      "unknown";
    const limited = rateLimit(`demo:${ip}`, 5, 10 * 60_000);
    if (!limited.ok) {
      return ok(
        {
          error: `Too many requests from this connection. Please try again in ${Math.ceil(limited.retryAfterSec / 60)} minute(s), or message us on WhatsApp.`,
        },
        429,
      );
    }

    const body = await readBody(req);

    // Bots fill the hidden field; answer as if it worked and store nothing.
    const trap = str(body.website, "Website", { optional: true, max: 120 });
    if (trap) return ok({ ok: true }, 201);

    const name = str(body.name, "Your name", { max: 120 });
    const digits = str(body.phone, "Mobile number", { max: 24 }).replace(/\D/g, "");
    if (digits.length < 10) return ok({ error: "Enter a 10-digit mobile number" }, 400);
    const email = str(body.email, "Email", { optional: true, max: 160 });
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      return ok({ error: "That email address does not look right" }, 400);
    }
    const firm = str(body.firm, "Firm name", { optional: true, max: 160 });
    const city = str(body.city, "City", { optional: true, max: 80 });
    const size = str(body.size, "Team size", { optional: true, max: 40 });
    const pain = str(body.pain, "Priority", { optional: true, max: 80 });
    const note = str(body.note, "Note", { optional: true, max: 600 });

    let score = 45;
    if (email) score += 15;
    if (firm) score += 10;
    if (note) score += 10;
    if (size === "20+ people") score += 15;
    else if (size === "6–20 people") score += 12;
    else if (size === "2–5 people") score += 8;
    score = Math.min(98, score);
    const category = score >= 75 ? "Hot" : score >= 55 ? "Warm" : "Cold";

    createLead({
      name,
      company_name: firm || name,
      phone: digits,
      email,
      source: "Website demo request",
      service_interest: pain || "General enquiry",
      lead_score: score,
      category,
      status: "New",
      notes: [
        size ? `Team size: ${size}` : "",
        city ? `City: ${city}` : "",
        note ? `Asked about: ${note}` : "",
        "Captured on the public site contact form",
      ]
        .filter(Boolean)
        .join(" · "),
    });

    // The public side only needs to know it worked — no internal ids leak back.
    return ok({ ok: true }, 201);
  } catch (err) {
    return handle(err);
  }
}
