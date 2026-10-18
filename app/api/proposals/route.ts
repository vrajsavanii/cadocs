import { createProposal, listLeads, listProposals } from "@/lib/db";
import { fail, handle, ok, readBody, str } from "@/lib/api";

export const dynamic = "force-dynamic";

export function GET() {
  try {
    return ok(listProposals());
  } catch (err) {
    return handle(err);
  }
}

export async function POST(req: Request) {
  try {
    const body = await readBody(req);
    const leadId = str(body.lead_id, "Lead", { max: 40 });
    const lead = listLeads().find((l) => l.lead_id === leadId);
    if (!lead) return fail("Lead not found", 404);

    const proposal = createProposal({
      lead_id: lead.lead_id,
      prospect_name: lead.name,
      company_name: lead.company_name || lead.name,
      entity_type: str(body.entity_type, "Entity type", { optional: true, max: 60 }) || "Private Limited",
      services: str(body.services, "Services", { optional: true, max: 240 }) || lead.service_interest || "GST Filing, ITR",
      fee: str(body.fee, "Fee", { optional: true, max: 80 }) || "₹15,000 / month",
      status: "Draft",
    });

    return ok(proposal, 201);
  } catch (err) {
    return handle(err);
  }
}
