import { handle, ok, readBody, str } from "@/lib/api";
import { aiDisclosure, complete } from "@/lib/ai";
import { rateLimit } from "@/lib/crypto";

export const dynamic = "force-dynamic";

/** Keyword classifier — the keyless fallback and safety net for bad AI output. */
const RULES: Array<{ category: string; keywords: string[] }> = [
  { category: "Bank Statement", keywords: ["bank statement", "statement", "bank"] },
  { category: "GST Return", keywords: ["gstr", "gst return", "gst"] },
  { category: "TDS Return", keywords: ["tds", "26q", "24q", "tcs"] },
  { category: "Income Tax Return", keywords: ["itr", "income tax", "return of income"] },
  { category: "Books of Accounts", keywords: ["ledger", "trial balance", "purchase register", "sales register", "journal", "cash book"] },
  { category: "Financial Statements", keywords: ["balance sheet", "p&l", "profit and loss", "financial statement", "schedule"] },
  { category: "Invoices", keywords: ["invoice", "bill", "purchase bill", "sales bill"] },
  { category: "Agreement", keywords: ["agreement", "contract", "lease", "rent deed", "partnership deed"] },
  { category: "Notice / Order", keywords: ["notice", "order", "summons", "assessment", "rectangular"] },
  { category: "Form 16 / 16A", keywords: ["form 16", "form16", "form 16a", "form16a", "26as", "ais", "tis"] },
  { category: "ROC Filing", keywords: ["mgt-7", "aoc-4", "roc", "board resolution", "share certificate", "annual return"] },
  { category: "KYC", keywords: ["pan", "aadhaar", "kyc", "photo", "id proof", "address proof"] },
];

function keywordClassify(name: string): { category: string; suggested_name: string } {
  const q = name.toLowerCase();
  for (const rule of RULES) {
    if (rule.keywords.some((k) => q.includes(k))) {
      return { category: rule.category, suggested_name: name.trim() };
    }
  }
  return { category: "General", suggested_name: name.trim() };
}

export async function POST(req: Request) {
  try {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
    const limited = rateLimit(`ai-classify:${ip}`, 30, 60_000);
    if (!limited.ok) return ok({ error: "Too many requests" }, 429);

    const body = await readBody(req);
    const name = str(body.name, "Document name", { max: 200 });
    const notes = str(body.notes, "Notes", { optional: true, max: 400 });

    const fallback = keywordClassify(name);
    const result = await complete({
      system:
        "You classify documents for an Indian CA firm. Respond ONLY with compact JSON: " +
        `{"category":"<one of: Bank Statement, GST Return, TDS Return, Income Tax Return, Books of Accounts, ` +
        "Financial Statements, Invoices, Agreement, Notice / Order, Form 16 / 16A, ROC Filing, KYC, Purchases, Sales, Payroll, General>\"," +
        '"suggested_name":"<Filename>_<ClientName or CompanyName>_<Period if known>.pdf"}. ' +
        "Keep the suggested name short, filesystem-safe (no spaces replaced issues — use underscores), no PAN or GSTIN values in it.",
      user: `Document: ${name}\nNotes: ${notes || "(none)"}`,
      maxTokens: 160,
      temperature: 0,
    });

    if (result) {
      try {
        const match = result.text.match(/\{[\s\S]*\}/);
        if (match) {
          const parsed = JSON.parse(match[0]) as { category?: string; suggested_name?: string };
          if (parsed.category && parsed.suggested_name) {
            return ok({
              category: parsed.category.slice(0, 60),
              suggested_name: parsed.suggested_name.slice(0, 120),
              source: result.provider,
              disclosure: aiDisclosure(),
            });
          }
        }
      } catch {
        // malformed model output — fall through to the keyword engine
      }
    }

    return ok({ ...fallback, source: "rules", disclosure: aiDisclosure() });
  } catch (err) {
    return handle(err);
  }
}