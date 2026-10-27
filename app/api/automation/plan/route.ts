import { getSessionUser } from "@/lib/auth";
import { planRuleFromText, planRuleWithAi } from "@/lib/automation";
import { aiDisclosure } from "@/lib/ai";
import { handle, ok, readBody, str } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * Turns a sentence ("chase documents older than a week, every morning") into a
 * rule draft. The deterministic planner always runs first; when a provider is
 * configured its answer is re-validated, so the draft can never carry an
 * unknown action or parameter.
 */
export async function POST(req: Request) {
  try {
    const user = await getSessionUser();
    if (!user) return ok({ error: "Sign in required" }, 401);
    if (user.role === "article") return ok({ error: "Only a partner or manager can configure automation" }, 403);

    const body = await readBody(req);
    const text = str(body.text, "Describe the automation", { max: 400 });

    const deterministic = planRuleFromText(text);
    const disclosure = aiDisclosure();
    let draft = deterministic;
    if (disclosure.enabled && disclosure.provider) {
      draft = (await planRuleWithAi(text)) ?? deterministic;
    }

    if (!draft) {
      return ok({
        draft: null,
        message:
          "I could not read that as an automation. Try: “chase documents older than 5 days on WhatsApp”, “remind clients about invoices 30 days late”, “create GSTR-3B every month due on the 20th”, “warn me 30 days before a DSC expires”.",
      });
    }
    return ok({ draft, disclosure });
  } catch (err) {
    return handle(err);
  }
}
