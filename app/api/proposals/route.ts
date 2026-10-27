import { createProposal, listProposals } from "@/lib/db";
import { handle, ok, readBody, str } from "@/lib/api";

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
    const prospect = str(body.prospect_name, "Prospect name", { max: 120 });
    const company = str(body.company_name, "Company name", { optional: true, max: 120 }) || prospect;

    const proposal = createProposal({
      lead_id: "",
      prospect_name: prospect,
      company_name: company,
      entity_type: str(body.entity_type, "Entity type", { optional: true, max: 60 }) || "Private Limited",
      services: str(body.services, "Services", { optional: true, max: 240 }) || "GST Filing, ITR",
      fee: str(body.fee, "Fee", { optional: true, max: 80 }) || "₹15,000 / month",
      status: "Draft",
    });

    return ok(proposal, 201);
  } catch (err) {
    return handle(err);
  }
}
