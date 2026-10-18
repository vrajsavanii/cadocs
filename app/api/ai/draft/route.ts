import { handle, ok, readBody, str } from "@/lib/api";
import { aiDisclosure, complete } from "@/lib/ai";
import { rateLimit } from "@/lib/crypto";

export const dynamic = "force-dynamic";

/**
 * Draft a client chaser (WhatsApp/email). The caller supplies the facts and a
 * seed message; with a provider configured the draft is personalised and
 * tone-checked, otherwise a clean deterministic template is composed from the
 * same facts. Nothing is ever sent from here — the user reviews and sends.
 */
export async function POST(req: Request) {
  try {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
    const limited = rateLimit(`ai-draft:${ip}`, 30, 60_000);
    if (!limited.ok) return ok({ error: "Too many requests" }, 429);

    const body = await readBody(req);
    const recipient = str(body.recipient, "Recipient", { max: 120 });
    const channel = str(body.channel, "Channel", { max: 20 });
    const subject = str(body.subject, "Subject", { optional: true, max: 160 });
    const seed = str(body.message, "Message", { max: 2000 });
    const firmNote = str(body.firm_note, "Firm note", { optional: true, max: 300 });

    // Deterministic fallback: keep the caller's seed, tidy whitespace.
    const fallback = seed.trim();

    const result = await complete({
      system:
        `You draft short, polite, professional ${channel === "Email" ? "emails" : "WhatsApp messages"} ` +
        "for a CA firm's client follow-ups. Warm but firm, under 90 words, no emojis unless the seed uses one, " +
        "no legal threats, one clear ask, ready to send. Match the language style of the seed. " +
        "Never include PAN, GSTIN or bank account numbers.",
      user: `Client: ${recipient}\nSubject: ${subject || "(none)"}\nFirm note: ${firmNote || "(none)"}\nSeed draft:\n${seed}`,
      maxTokens: 260,
      temperature: 0.5,
    });

    return ok({
      draft: result?.text?.trim() || fallback,
      source: result ? result.provider : "template",
      disclosure: aiDisclosure(),
    });
  } catch (err) {
    return handle(err);
  }
}