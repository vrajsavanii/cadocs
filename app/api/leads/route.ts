import { createLead, listLeads } from "@/lib/db";
import { handle, num, ok, pick, readBody, str } from "@/lib/api";
import type { Lead } from "@/lib/types";

export const dynamic = "force-dynamic";

export function GET() {
  try {
    return ok(listLeads());
  } catch (err) {
    return handle(err);
  }
}

export async function POST(req: Request) {
  try {
    const body = await readBody(req);
    const score = num(body.lead_score, "Lead score", { min: 0, max: 100, optional: true });
    const lead = createLead({
      name: str(body.name, "Lead name", { max: 120 }),
      company_name: str(body.company_name, "Firm / company", { optional: true, max: 120 }),
      phone: str(body.phone, "Phone", { max: 20 }).replace(/\D/g, ""),
      email: str(body.email, "Email", { optional: true, max: 160 }),
      source: str(body.source, "Source", { optional: true, max: 60 }) || "Website",
      service_interest: str(body.service_interest, "Service interest", { optional: true, max: 160 }) || "GST Filing, ITR",
      lead_score: score || 50,
      category: pick<Lead["category"]>(body.category, ["Hot", "Warm", "Cold"], "Category", score >= 75 ? "Hot" : score >= 55 ? "Warm" : "Cold"),
      status: pick<Lead["status"]>(body.status, ["New", "Contacted", "Qualified", "Proposal Sent", "Won", "Lost"], "Status", "New"),
      notes: str(body.notes, "Notes", { optional: true, max: 500 }),
    });
    return ok(lead, 201);
  } catch (err) {
    return handle(err);
  }
}
