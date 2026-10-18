import { getProposal, listLeads, updateLead, updateProposalStatus } from "@/lib/db";
import { fail, handle, ok, pick, readBody } from "@/lib/api";
import type { Proposal } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const proposal = getProposal(id);
    if (!proposal) return fail("Proposal not found", 404);
    return ok(proposal);
  } catch (err) {
    return handle(err);
  }
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const body = await readBody(req);
    const status = pick<Proposal["status"]>(body.status, ["Draft", "Sent", "Accepted", "Declined"], "Status");
    const updated = updateProposalStatus(id, status);
    if (!updated) return fail("Proposal not found", 404);

    if (updated.lead_id) {
      const lead = listLeads().find((l) => l.lead_id === updated.lead_id);
      const closed = lead ? ["Won", "Lost"].includes(lead.status) : true;
      if (lead && !closed && status === "Sent") updateLead(lead.lead_id, { status: "Proposal Sent" });
      if (lead && !closed && status === "Accepted") updateLead(lead.lead_id, { status: "Won" });
    }

    return ok(updated);
  } catch (err) {
    return handle(err);
  }
}
